/**
 * The one engine this page ever builds, and the one rule that forced its shape.
 *
 * `createAudio` takes its recipe table once, at construction, and the only way to hand it a
 * different one is to build a different engine — which means `dispose()`, which closes the
 * `AudioContext`. A document gets about six of those, ever. A page whose entire purpose is a
 * slider you drag while listening therefore cannot rebuild the engine when the table changes; six
 * drags and it would be permanently silent.
 *
 * So the table is built once with mutable definition objects and **edited in place**. The package
 * says plainly that the `SoundDef`s inside its frozen record are the caller's own objects and are
 * not deep-frozen, and that mutating one still changes what plays — offered there as a warning.
 * Here it is the load-bearing decision, and this is the only file allowed to do it.
 *
 * The ids never move: they are the twenty-four sketches, fixed at module load, so the id union the
 * engine inferred at construction stays true no matter what the sliders do.
 */

import { BUS_NAMES, createAudio, createBed, createDeck, effectiveGain } from '@latticekit/audio';
import type { Audio, Bed, BedLayer, BedOptions, BusId, BusName, Layer, MusicDeck, SoundDef, VoicePlan } from '@latticekit/audio';
import { SKETCHES } from './kit.js';

/** The same shape as `SoundDef`, with the readonly taken off the two fields that move. */
interface MutableSoundDef {
  layers: readonly Layer[];
  bus?: 'ui' | 'sfx' | 'music';
  minGapMs: number;
  ladder?: { readonly steps: number; readonly windowMs: number };
  spatial?: boolean;
}

const TABLE: Record<string, MutableSoundDef> = {};
for (const sketch of SKETCHES) {
  TABLE[sketch.id] = { layers: [{ wave: 'sine', hz: 440, gain: 0.1, hold: 0.05 }], bus: sketch.bus, minGapMs: sketch.minGapMs };
}

export type LiveAudio = Audio<string>;

let engine: LiveAudio | null = null;

function ensure(): LiveAudio {
  engine ??= createAudio({ sounds: TABLE as Readonly<Record<string, SoundDef>> });
  return engine;
}

/**
 * The state of the one thing on this page that a browser will not let us do unasked.
 *
 * `blocked` is separate from `refused` because they are different failures with different answers:
 * refused is a browser with no WebAudio at all, blocked is a context that exists and is not
 * running — which on a phone usually means the gesture never actually counted.
 */
export type UnlockState = 'waiting' | 'ready' | 'refused' | 'blocked';

let unlockState: UnlockState = 'waiting';
const unlockListeners = new Set<(state: UnlockState) => void>();

export function onUnlockChange(listener: (state: UnlockState) => void): void {
  unlockListeners.add(listener);
  listener(unlockState);
}

/**
 * Called from real interaction handlers and from nowhere else.
 *
 * Idempotent and cheap, and it has to be called from *every* handler rather than once: a tab left
 * in the background long enough gets its context suspended, and a page that only ever unlocks once
 * works for one session and then goes quiet with no error anywhere.
 */
/**
 * Ask iOS for the media channel rather than the ambient one.
 *
 * This is the whole reason a page can be perfectly audible on a desktop and silent on an iPhone in
 * both browsers at once — which is not two bugs, because every browser on iOS is WebKit. By
 * default WebAudio there is routed to the *ambient* channel, and the ambient channel is what the
 * hardware ring/silent switch silences. The page does everything else right, the context runs, the
 * clock advances, `play()` is accepted, and the speaker stays quiet.
 *
 * `navigator.audioSession` (Safari 16.4+) is the supported way to say that this is playback and
 * should be treated like a video or a track. It is set before the context is built, because the
 * category a context is created under is the one it keeps.
 *
 * On iOS older than 16.4 there is no way to ask, and the answer is the honest notice in the
 * masthead rather than a claim that the audio is running.
 */
function claimPlaybackSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session === undefined) return;
  try {
    session.type = 'playback';
  } catch {
    // A browser that has the property and refuses the value. Nothing to do, and not worth throwing.
  }
}

/** Whether this browser can be asked for the media channel at all. False on iOS before 16.4. */
export function canClaimPlayback(): boolean {
  return typeof navigator !== 'undefined'
    && (navigator as Navigator & { audioSession?: unknown }).audioSession !== undefined;
}

let kicked = false;

/**
 * Start one silent sample, inside the gesture.
 *
 * `resume()` alone is enough on a desktop. On iOS the audio hardware is not actually started until
 * something is *played* through the context during a user gesture, and a context that has never
 * played anything can sit in `running` and emit nothing — a state with no error, no warning and no
 * way to tell from the outside. One sample of silence costs nothing and settles it.
 *
 * It has to happen here rather than on the first real `play()`, because the first real play is
 * usually not the same gesture as the one that unlocked.
 */
function kickstart(context: AudioContext): void {
  if (kicked) return;
  kicked = true;
  try {
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  } catch {
    // Nothing here is load-bearing: if it throws, the context is in a state the rest of this file
    // already reports honestly.
  }
}

function announce(next: UnlockState): void {
  if (next === unlockState) return;
  unlockState = next;
  for (const listener of unlockListeners) listener(next);
}

/**
 * Whether the device is actually running, as opposed to merely existing.
 *
 * `unlock()` returns `available`, which is true the moment a context object has been constructed —
 * suspended or not. That distinction is invisible on a desktop and is the whole story on a phone,
 * so it is checked here rather than reported as success.
 */
let watching: AudioContext | null = null;
let graceTimer = 0;

/**
 * Report whether the device is actually running, as opposed to merely existing.
 *
 * `unlock()` returns `available`, which is true the moment a context object has been constructed —
 * suspended or not. That distinction is invisible on a desktop and is the whole story on a phone,
 * so it is checked here rather than reported as success.
 *
 * The authority is the context's own `statechange` event rather than a timer. A `resume()` started
 * inside a gesture resolves whenever it resolves; polling it after some guessed interval is how a
 * page ends up showing a warning that stopped being true, or missing one that started being true.
 * The only timer here is a short grace before *complaining* — long enough that a context which is
 * about to start does not flash a warning on its way there.
 */
function settle(): void {
  const context = ensure().context;
  if (context === null) {
    announce('refused');
    return;
  }
  kickstart(context);

  const report = (): void => {
    if (context.state === 'running') {
      window.clearTimeout(graceTimer);
      announce('ready');
    } else if (unlockState !== 'blocked') {
      window.clearTimeout(graceTimer);
      graceTimer = window.setTimeout(() => {
        if (context.state !== 'running') announce('blocked');
      }, 600);
    }
  };

  if (watching !== context) {
    watching = context;
    context.addEventListener('statechange', report);
  }
  report();
}

export function unlock(): boolean {
  claimPlaybackSession();
  const ok = ensure().unlock();
  if (!ok) {
    announce('refused');
    return false;
  }
  settle();
  return true;
}

export function audio(): LiveAudio {
  return ensure();
}

/** Copy a freshly-built table into the live definitions. See the note at the top of the file. */
export function syncKit(table: Readonly<Record<string, SoundDef>>): void {
  for (const [id, def] of Object.entries(table)) {
    const live = TABLE[id];
    if (live === undefined) continue;
    live.layers = def.layers;
    live.minGapMs = def.minGapMs;
    live.bus = def.bus ?? 'sfx';
    if (def.ladder) live.ladder = def.ladder;
    else delete live.ladder;
  }
}

export function setMaxPan(maxPan: number): void {
  ensure().setMaxPan(maxPan);
}

export function play(id: string, options?: { gain?: number; pan?: number; detune?: number }): boolean {
  unlock();
  return ensure().play(id, options);
}

/**
 * Push a saved mixer state onto the buses.
 *
 * Called at boot and not only when the floor is on screen: the mixer belongs to the page rather
 * than to one room, and a bus muted on the floor must still be muted — and *visibly* muted — when
 * a sound on it refuses to make a noise on the bench.
 */
export function applyMixer(
  gains: Record<BusName, number>,
  muted: Record<BusName, boolean>,
  maxVoices: number,
  maxPan: number,
): void {
  const mixer = ensure().mixer;
  for (const bus of BUS_NAMES) {
    mixer.setGain(bus, gains[bus]);
    mixer.setMuted(bus, muted[bus]);
  }
  ensure().setMaxVoices(maxVoices);
  ensure().setMaxPan(maxPan);
}

/** What a sound on this bus would actually come out at, after the bus and master. */
export function busGain(bus: BusId): number {
  const mixer = ensure().mixer;
  return effectiveGain(mixer, bus) * effectiveGain(mixer, 'master');
}

export function watchVoices(listener: (plan: Readonly<VoicePlan>) => void): () => void {
  return ensure().onScheduled(listener);
}

/* --------------------------------------------------------------------------------------------
   The bed and the deck, both of which may be rebuilt freely — neither owns the context
   -------------------------------------------------------------------------------------------- */

let bed: Bed | null = null;
let bedId = '';

export function setBed(id: string, layers: readonly BedLayer[], options: BedOptions | undefined, level: number, tone: number): void {
  if (id !== bedId) {
    bed?.stop(0.4);
    bed = layers.length > 0 ? createBed(ensure(), layers, options) : null;
    bedId = id;
  }
  bed?.set(level, tone);
}

export function driveBed(level: number, tone: number): void {
  bed?.set(level, tone);
}

let deck: MusicDeck | null = null;

export function musicDeck(): MusicDeck {
  deck ??= createDeck(ensure());
  return deck;
}
