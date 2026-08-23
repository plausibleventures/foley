/**
 * Everything the page is, in one object, and the codec that puts it in the address bar.
 *
 * There is no server here, so the URL is the save file. That is worth the small cost of writing a
 * codec by hand: keys are one character, anything still at its default is left out, and a pattern
 * is the same sixteen-token notation the starting patterns are written in. A kit with no hand
 * edits comes out around two hundred characters and a whole track under a thousand.
 */

import type { BusName, MixerState, Song, SoundDef, Track } from '@latticekit/audio';
import { DEFAULT_AXES, buildKit, type Axes, type KitSpec, type SoundOverride } from './audio/kit.js';
import { INSTRUMENT_BY_ID } from './audio/instruments.js';
import { PATTERN_BY_ID, PATTERNS, line, type MutableNote } from './audio/patterns.js';

/* --------------------------------------------------------------------------------------------
   Shapes
   -------------------------------------------------------------------------------------------- */

export interface BenchState {
  voicing: string;
  axes: Axes;
  selected: string;
  /** Sounds that have been edited by hand and no longer follow the material or the axes. */
  overrides: Record<string, SoundOverride>;
  kitName: string;
  normalise: boolean;
}

export interface WorkTrack {
  id: string;
  instrument: string;
  notes: MutableNote[];
  bars: number[] | null;
  drop: number;
  minIntensity: number;
  muted: boolean;
}

export interface FloorState {
  pattern: string;
  bpm: number;
  /** Semitones from A1 (55 Hz). The song's root, and every note is an interval over it. */
  rootKey: number;
  progression: number[];
  seed: number;
  tracks: WorkTrack[];
  intensity: number;
  bed: string;
  bedLevel: number;
  bedTone: number;
  bars: number;
  normaliseTake: boolean;
  gains: Record<BusName, number>;
  mutedBuses: Record<BusName, boolean>;
  maxVoices: number;
  /** Absolute pan limit, 0–1. `setMaxPan(0)` is a mono switch and a real accessibility setting. */
  maxPan: number;
  /** Semitones applied to every pad hit, so a kit in one key can play over a song in another. */
  padDetune: number;
}

export interface State {
  room: 'bench' | 'floor';
  bench: BenchState;
  floor: FloorState;
}

/* --------------------------------------------------------------------------------------------
   Defaults
   -------------------------------------------------------------------------------------------- */

export function floorFromPattern(id: string): FloorState {
  const pattern = PATTERN_BY_ID.get(id) ?? PATTERNS[0]!;
  const song = pattern.song;
  return {
    pattern: pattern.id,
    bpm: song.bpm,
    rootKey: Math.round(12 * Math.log2(song.rootHz / 55)),
    progression: [...song.progression],
    seed: song.seed ?? 0,
    tracks: song.tracks.map((track) => ({
      id: track.id,
      instrument: pattern.instruments[track.id] ?? track.id,
      notes: track.notes.map((note) => ({ ...note })),
      bars: track.bars ? [...track.bars] : null,
      drop: track.drop ?? 0,
      minIntensity: track.minIntensity ?? 0,
      muted: false,
    })),
    intensity: 0.75,
    bed: pattern.bed,
    bedLevel: pattern.bedLevel,
    bedTone: pattern.bedTone,
    bars: 8,
    normaliseTake: true,
    // Louder than a game would ship, because here the music *is* the product rather than the
    // thing under it. The summed worst case still leaves headroom: the deck's own ceiling holds
    // any one step to 0.5, and these multiply into that rather than adding to it.
    gains: { master: 0.95, music: 0.95, sfx: 0.9, ui: 0.9 },
    mutedBuses: { master: false, music: false, sfx: false, ui: false },
    maxVoices: 24,
    maxPan: 0.6,
    padDetune: 0,
  };
}

export function defaultState(): State {
  return {
    room: 'bench',
    bench: {
      voicing: 'glass',
      axes: { ...DEFAULT_AXES },
      selected: 'tap',
      overrides: {},
      kitName: 'foley',
      normalise: false,
    },
    floor: floorFromPattern('nightbus'),
  };
}

/* --------------------------------------------------------------------------------------------
   Derived
   -------------------------------------------------------------------------------------------- */

export function specOf(bench: BenchState): KitSpec {
  return { voicing: bench.voicing, axes: bench.axes };
}

export function kitOf(bench: BenchState): Record<string, SoundDef> {
  return buildKit(specOf(bench), bench.overrides);
}

export function rootHzOf(floor: FloorState): number {
  return 55 * Math.pow(2, floor.rootKey / 12);
}

export function songOf(floor: FloorState): Song {
  const tracks: Track[] = [];
  for (const work of floor.tracks) {
    const instrument = INSTRUMENT_BY_ID.get(work.instrument);
    if (instrument === undefined) continue;
    tracks.push({
      id: work.id,
      voice: instrument.voice,
      notes: work.notes,
      melodic: instrument.melodic,
      ...(work.bars ? { bars: work.bars } : {}),
      ...(work.drop > 0 ? { drop: work.drop } : {}),
      ...(work.minIntensity > 0 ? { minIntensity: work.minIntensity } : {}),
    });
  }
  return {
    bpm: floor.bpm,
    steps: 16,
    rootHz: rootHzOf(floor),
    progression: floor.progression.length > 0 ? floor.progression : [0],
    seed: floor.seed,
    tracks,
  };
}

export function mixerStateOf(floor: FloorState): MixerState {
  return { version: 1, gain: { ...floor.gains }, muted: { ...floor.mutedBuses } };
}

export function secondsPerBar(floor: FloorState): number {
  return (60 / floor.bpm) * 4;
}

/* --------------------------------------------------------------------------------------------
   The codec
   -------------------------------------------------------------------------------------------- */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Sixteen tokens: a rest, or the semitone offset. The notation the patterns are authored in. */
function notesToSpec(notes: readonly MutableNote[]): string {
  const tokens = Array.from({ length: 16 }, () => '.');
  for (const note of notes) {
    if (note.step >= 0 && note.step < 16) tokens[note.step] = String(note.semis ?? 0);
  }
  return tokens.join(' ').replaceAll(/\s+/g, ' ');
}

const AXIS_KEYS: readonly (keyof Axes)[] = ['key', 'brightness', 'body', 'attack', 'presence', 'air', 'shimmer', 'sweep'];

export function encodeState(state: State): string {
  const bench = state.bench;
  const b: Record<string, unknown> = { v: bench.voicing, s: bench.selected };
  const axes: Record<string, number> = {};
  for (const key of AXIS_KEYS) {
    if (bench.axes[key] !== DEFAULT_AXES[key]) axes[key[0]! + key.slice(-1)] = Number(bench.axes[key].toFixed(3));
  }
  if (Object.keys(axes).length > 0) b['a'] = axes;
  if (Object.keys(bench.overrides).length > 0) b['o'] = bench.overrides;
  if (bench.kitName !== 'foley') b['n'] = bench.kitName;

  const floor = state.floor;
  const f: Record<string, unknown> = {
    p: floor.pattern,
    b: floor.bpm,
    r: floor.rootKey,
    g: floor.progression,
    e: floor.seed,
    i: Number(floor.intensity.toFixed(2)),
    d: floor.bed,
    dl: Number(floor.bedLevel.toFixed(2)),
    dt: Number(floor.bedTone.toFixed(2)),
    z: floor.bars,
    nz: floor.normaliseTake ? 1 : 0,
    t: floor.tracks.map((track) => [
      track.id,
      track.instrument,
      notesToSpec(track.notes),
      track.bars ? track.bars.join('') : '',
      Number(track.drop.toFixed(2)),
      Number(track.minIntensity.toFixed(2)),
      track.muted ? 1 : 0,
    ]),
    // Levels travel; **mutes do not**. A link that arrives silent is a link that looks broken, and
    // a mute is a decision about this listener's room rather than about the track. The package
    // makes the same distinction: mixer state is a device preference, not save state.
    m: [floor.gains.master, floor.gains.music, floor.gains.sfx, floor.gains.ui].map((g) => Number(g.toFixed(2))),
    x: floor.maxVoices,
    w: Number(floor.maxPan.toFixed(2)),
    q: floor.padDetune,
  };

  return toBase64Url(JSON.stringify({ r: state.room === 'floor' ? 1 : 0, b, f }));
}

function num(value: unknown, fallback: number, low: number, high: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, parsed));
}

export function decodeState(encoded: string): State | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  const state = defaultState();

  state.room = raw['r'] === 1 ? 'floor' : 'bench';

  const b = raw['b'] as Record<string, unknown> | undefined;
  if (b) {
    if (typeof b['v'] === 'string') state.bench.voicing = b['v'];
    if (typeof b['s'] === 'string') state.bench.selected = b['s'];
    if (typeof b['n'] === 'string') state.bench.kitName = b['n'];
    const axes = b['a'] as Record<string, number> | undefined;
    if (axes) {
      for (const key of AXIS_KEYS) {
        const short = key[0]! + key.slice(-1);
        if (short in axes) {
          state.bench.axes[key] = key === 'key' ? num(axes[short], 5, -24, 24) : num(axes[short], 0.5, 0, 1);
        }
      }
    }
    const overrides = b['o'];
    if (overrides && typeof overrides === 'object') {
      state.bench.overrides = overrides as Record<string, SoundOverride>;
    }
  }

  const f = raw['f'] as Record<string, unknown> | undefined;
  if (f) {
    const floor = state.floor;
    if (typeof f['p'] === 'string') floor.pattern = f['p'];
    floor.bpm = num(f['b'], floor.bpm, 40, 200);
    floor.rootKey = Math.round(num(f['r'], floor.rootKey, -24, 24));
    if (Array.isArray(f['g'])) floor.progression = (f['g'] as number[]).slice(0, 8).map((v) => Math.round(num(v, 0, -24, 24)));
    floor.seed = Math.round(num(f['e'], floor.seed, 0, 9999));
    floor.intensity = num(f['i'], floor.intensity, 0, 1);
    if (typeof f['d'] === 'string') floor.bed = f['d'];
    floor.bedLevel = num(f['dl'], floor.bedLevel, 0, 1);
    floor.bedTone = num(f['dt'], floor.bedTone, 0, 1);
    floor.bars = Math.round(num(f['z'], floor.bars, 1, 32));
    if ('nz' in f) floor.normaliseTake = f['nz'] === 1;
    floor.maxVoices = Math.round(num(f['x'], floor.maxVoices, 2, 32));
    floor.maxPan = num(f['w'], floor.maxPan, 0, 1);
    floor.padDetune = Math.round(num(f['q'], floor.padDetune, -12, 12));
    if (Array.isArray(f['m'])) {
      const gains = f['m'] as number[];
      floor.gains = {
        master: num(gains[0], 0.95, 0, 1),
        music: num(gains[1], 0.95, 0, 1),
        sfx: num(gains[2], 0.9, 0, 1),
        ui: num(gains[3], 0.9, 0, 1),
      };
    }
    if (Array.isArray(f['t'])) {
      const tracks: WorkTrack[] = [];
      for (const entry of f['t'] as unknown[]) {
        if (!Array.isArray(entry)) continue;
        const [id, instrument, spec, bars, drop, minIntensity, muted] = entry as [
          string, string, string, string, number, number, number,
        ];
        if (typeof id !== 'string' || !INSTRUMENT_BY_ID.has(instrument)) continue;
        tracks.push({
          id,
          instrument,
          notes: line(typeof spec === 'string' ? spec : ''),
          bars: typeof bars === 'string' && bars.length > 0 ? [...bars].map(Number).filter((n) => Number.isInteger(n)) : null,
          drop: num(drop, 0, 0, 0.5),
          minIntensity: num(minIntensity, 0, 0, 1),
          muted: muted === 1,
        });
      }
      if (tracks.length > 0) floor.tracks = tracks;
    }
  }

  return state;
}

export function writeUrl(state: State): void {
  const url = new URL(window.location.href);
  url.searchParams.set('s', encodeState(state));
  window.history.replaceState(null, '', url.toString());
}

export function readUrl(): State | null {
  const encoded = new URL(window.location.href).searchParams.get('s');
  return encoded === null ? null : decodeState(encoded);
}
