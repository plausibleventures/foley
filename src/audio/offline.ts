/**
 * Rendering the same engine into a file instead of into a speaker.
 *
 * The WAV you download is not a re-implementation of what you just heard — it is the identical
 * `@latticekit/audio` engine, the identical recipe table, and the identical deck, pointed at an
 * `OfflineAudioContext`. That is the whole reason the two cannot drift: there is no second
 * synthesiser here to keep in step with the first.
 *
 * Two things have to be arranged for that to work, and both are consequences of the package's
 * own design rather than accidents:
 *
 * **The clock.** The engine defaults to `context.currentTime`, which on an offline context stays
 * at zero until rendering starts and then runs faster than real time. A frozen clock is worse
 * than a wrong one: every sound's `minGapMs` is measured against it, so the second play of any id
 * would be refused for ever. So an offline render injects its own clock and advances it by hand,
 * which is exactly the seam `AudioOptions.now` exists for.
 *
 * **The gesture.** `unlock()` calls `resume()` on a suspended context, and an offline context is
 * suspended until `startRendering`. Rather than patch the package, the context handed to it
 * reports itself as already running — see {@link runningContext}.
 */

import { createAudio, createBed, createDeck } from '@latticekit/audio';
import type { BedLayer, MixerState, Song, SoundDef } from '@latticekit/audio';

export const SAMPLE_RATE = 44100;

/**
 * An offline context that claims to be running.
 *
 * The engine's renderer resumes anything reporting `suspended`, and `OfflineAudioContext.resume`
 * rejects — or in some engines throws — before rendering has started. One property is a smaller
 * lie than a fork of the package, and nothing else in the renderer reads `state`.
 */
function runningContext(context: OfflineAudioContext): AudioContext {
  return new Proxy(context, {
    get(target, property) {
      if (property === 'state') return 'running';
      // `close()` belongs to `AudioContext` and not to `BaseAudioContext`, so an offline context
      // does not have one — and `dispose()` calls it. There is nothing to close: rendering has
      // finished by the time anything disposes this, and the context is garbage after that.
      if (property === 'close') return () => Promise.resolve();
      // Bound, because these are prototype methods on a host object and an unbound copy called
      // through the proxy would be invoked with the proxy as `this` and throw `Illegal invocation`.
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as AudioContext;
}

/** The last moment a sound is still making any noise, so a render is long enough and no longer. */
export function durationOf(sound: SoundDef): number {
  let end = 0;
  for (const layer of sound.layers) {
    const life = (layer.delay ?? 0) + (layer.attack ?? 0.006) + layer.hold;
    if (life > end) end = life;
  }
  // The decay is exponential and lands on a floor rather than on zero, and the renderer holds the
  // source open for a moment past that. Half a beat of grace costs nothing in a file that is trimmed.
  return end + 0.12;
}

/**
 * Render one sound on its own, from a standing start, exactly as `play()` would schedule it.
 *
 * Mono unless some layer is actually panned. Two identical channels is twice the file for nothing,
 * and an interface sound is nearly always meant to arrive in the middle — the two in this kit that
 * are not are the two that are *about* direction.
 */
export async function renderSound(sound: SoundDef, options: { readonly gain?: number } = {}): Promise<AudioBuffer> {
  const seconds = durationOf(sound) + 0.05;
  const channels = sound.layers.some((layer) => (layer.pan ?? 0) !== 0) ? 2 : 1;
  const context = new OfflineAudioContext(channels, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const audio = createAudio({
    sounds: { one: sound },
    context: () => runningContext(context),
    // Zero, not a small epsilon: whatever this is becomes leading silence in the file, and the
    // trim afterwards should have nothing to do.
    now: () => 0,
  });
  audio.unlock();
  audio.play('one', options.gain !== undefined ? { gain: options.gain } : undefined);
  const buffer = await context.startRendering();
  audio.dispose();
  return buffer;
}

/** One live pad hit, captured while the floor was running, in seconds from the take's start. */
export interface Hit {
  readonly id: string;
  readonly at: number;
  readonly gain?: number;
  readonly pan?: number;
}

export interface ArrangementSpec {
  readonly sounds: Readonly<Record<string, SoundDef>>;
  readonly song: Song | null;
  readonly bed: { readonly layers: readonly BedLayer[]; readonly level: number; readonly tone: number } | null;
  readonly hits: readonly Hit[];
  readonly intensity: number;
  readonly mutedTracks: readonly string[];
  readonly mixer: MixerState;
  readonly seconds: number;
  /** Seconds of decay allowed to run past the end, so a final chord is not chopped. */
  readonly tailSec?: number;
}

/**
 * Render a whole take — the sequencer, the bed and every pad hit — into one buffer.
 *
 * The clock is advanced in half-second strides and the deck is pumped at each one. That interval
 * is not arbitrary: the deck schedules {@link LOOKAHEAD_SEC} (1.5 s) ahead and refuses to place a
 * note in the past, so a stride longer than the horizon would step over notes and a much shorter
 * one only costs work. Pad hits are fired inside the stride they belong to, with an explicit
 * `at`, so a performance keeps the timing it was played with rather than being quantised.
 */
export async function renderArrangement(spec: ArrangementSpec): Promise<AudioBuffer> {
  const tail = spec.tailSec ?? 1.6;
  const total = spec.seconds + tail;
  const context = new OfflineAudioContext(2, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE);

  let clock = 0.02;
  const audio = createAudio({
    sounds: spec.sounds,
    context: () => runningContext(context),
    now: () => clock,
  });
  audio.unlock();
  audio.mixer.restore(spec.mixer);

  const bed = spec.bed && spec.bed.level > 0 ? createBed(audio, spec.bed.layers, { glideSec: 0.05 }) : null;
  bed?.set(spec.bed!.level, spec.bed!.tone);

  const deck = spec.song ? createDeck(audio, { autoPump: false }) : null;
  if (deck && spec.song) {
    deck.setIntensity(spec.intensity);
    for (const id of spec.mutedTracks) deck.setTrackMuted(id, true);
    deck.play(spec.song, { fadeSec: 0.01 });
  }

  const hits = [...spec.hits].sort((a, b) => a.at - b.at);
  let next = 0;
  const stride = 0.5;
  const start = clock;

  for (let elapsed = 0; elapsed <= spec.seconds; elapsed += stride) {
    clock = start + elapsed;
    deck?.pump();
    const until = elapsed + stride;
    while (next < hits.length && hits[next]!.at < until) {
      const hit = hits[next]!;
      next += 1;
      if (hit.at > spec.seconds) continue;
      if (!(hit.id in spec.sounds)) continue;
      audio.play(hit.id, {
        at: start + hit.at,
        ...(hit.gain !== undefined ? { gain: hit.gain } : {}),
        ...(hit.pan !== undefined ? { pan: hit.pan } : {}),
      });
    }
  }

  const buffer = await context.startRendering();
  audio.dispose();
  return buffer;
}
