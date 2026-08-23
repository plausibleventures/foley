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

/** The state of the one thing on this page that a browser will not let us do unasked. */
export type UnlockState = 'waiting' | 'ready' | 'refused';

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
export function unlock(): boolean {
  const ok = ensure().unlock();
  const next: UnlockState = ok ? 'ready' : 'refused';
  if (next !== unlockState) {
    unlockState = next;
    for (const listener of unlockListeners) listener(next);
  }
  return ok;
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
