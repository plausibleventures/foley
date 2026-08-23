/**
 * Six starting points, and the notation they are written in.
 *
 * A pattern is sixteen tokens: `.` is a rest and anything else is a semitone offset above the
 * bar's root. Percussion ignores the number and every drum line here writes `0`, which keeps one
 * notation for both halves of the kit — the alternative is two, and two notations for one grid is
 * one too many for a file anybody has to edit by hand.
 */

import type { Song, Track } from '@latticekit/audio';
import { INSTRUMENT_BY_ID } from './instruments.js';

/** A note being edited. Structurally a `Note`, with the `readonly` off so a grid can move it. */
export interface MutableNote {
  step: number;
  semis?: number;
}

/** `'0 . . . 7 . . . . . 12 . . . . .'` — sixteen tokens, whitespace separated. */
export function line(spec: string): MutableNote[] {
  const notes: MutableNote[] = [];
  const tokens = spec.trim().split(/\s+/);
  tokens.forEach((token, step) => {
    if (token === '.' || token === '') return;
    const semis = Number(token);
    if (!Number.isFinite(semis)) return;
    notes.push(semis === 0 ? { step } : { step, semis });
  });
  return notes;
}

/** Build a track from an instrument id, so a pattern names instruments rather than waveforms. */
export function track(
  id: string,
  instrument: string,
  spec: string,
  extra: { bars?: readonly number[]; minIntensity?: number; drop?: number } = {},
): Track {
  const found = INSTRUMENT_BY_ID.get(instrument);
  if (found === undefined) throw new Error(`unknown instrument ${instrument}`);
  return {
    id,
    voice: found.voice,
    notes: line(spec),
    melodic: found.melodic,
    ...(extra.bars ? { bars: extra.bars } : {}),
    ...(extra.minIntensity !== undefined ? { minIntensity: extra.minIntensity } : {}),
    ...(extra.drop !== undefined ? { drop: extra.drop } : {}),
  };
}

/** The instrument each track was built from, so the grid can label and re-voice it. */
export type TrackInstruments = Readonly<Record<string, string>>;

export interface Pattern {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly song: Song;
  readonly instruments: TrackInstruments;
  /** Which bed goes under it. */
  readonly bed: string;
  readonly bedLevel: number;
  readonly bedTone: number;
}

export const PATTERNS: readonly Pattern[] = [
  {
    id: 'foundry', name: 'Foundry', bed: 'plant', bedLevel: 0.5, bedTone: 0.45,
    note: 'Slow, mechanical, in A minor. The stab sits out two bars in four, which is the cheapest ' +
      'way to stop a loop announcing where it begins.',
    instruments: { thud: 'thud', rim: 'rim', hat: 'hat', sub: 'sub', stab: 'stab', pad: 'pad' },
    song: {
      bpm: 96, steps: 16, rootHz: 55, seed: 11, progression: [0, 0, -2, 3],
      tracks: [
        track('thud', 'thud', '0 . . . . . . . 0 . . . . . 0 .'),
        track('rim', 'rim', '. . . . 0 . . . . . . . 0 . . .'),
        track('hat', 'hat', '. . 0 . . . 0 . . . 0 . . . 0 .', { drop: 0.12 }),
        track('sub', 'sub', '0 . . . . . 7 . . . . . 5 . . .'),
        track('stab', 'stab', '. . . 24 . . . . . . 31 . . . . .', { bars: [1, 3], minIntensity: 0.35 }),
        track('pad', 'pad', '12 . . . . . . . . . . . . . . .', { minIntensity: 0.6 }),
      ],
    },
  },
  {
    id: 'nightbus', name: 'Nightbus', bed: 'rain', bedLevel: 0.42, bedTone: 0.55,
    note: 'Am–F–C–G at eighty-four, which is the tempo everything unhurried ends up at. The bell ' +
      'speaks on two bars of the four and the keys drop one note in eight.',
    instruments: { kick: 'kick', snare: 'snare', hat: 'hat', bass: 'bass', keys: 'keys', bell: 'bell' },
    song: {
      bpm: 84, steps: 16, rootHz: 55, seed: 7, progression: [0, -4, 3, -2],
      tracks: [
        track('kick', 'kick', '0 . . . . . . . 0 . . . . . . .'),
        track('snare', 'snare', '. . . . 0 . . . . . . . 0 . . .'),
        track('hat', 'hat', '. . 0 . . . 0 . . . 0 . . . 0 .', { drop: 0.1 }),
        track('bass', 'bass', '0 . . . . . . 7 . . 0 . . . 10 .'),
        track('keys', 'keys', '. . . . 24 . . . . . 28 . . . . .', { drop: 0.12, minIntensity: 0.3 }),
        track('bell', 'bell', '. . . . . . . . 36 . . . . . 43 .', { bars: [1, 3], minIntensity: 0.55 }),
      ],
    },
  },
  {
    id: 'ticker', name: 'Ticker', bed: 'room', bedLevel: 0.3, bedTone: 0.8,
    note: 'Four to the floor at a hundred and twenty-eight, offbeat hats, and almost no harmony — ' +
      'the progression barely moves so the interest has to come from the drops.',
    instruments: { kick: 'kick', clap: 'clap', hat: 'hat', shaker: 'shaker', sub: 'sub', stab: 'stab' },
    song: {
      bpm: 128, steps: 16, rootHz: 55, seed: 3, progression: [0, 0, 0, -2],
      tracks: [
        track('kick', 'kick', '0 . . . 0 . . . 0 . . . 0 . . .'),
        track('clap', 'clap', '. . . . 0 . . . . . . . 0 . . .', { minIntensity: 0.25 }),
        track('hat', 'hat', '. . 0 . . . 0 . . . 0 . . . 0 .'),
        track('shaker', 'shaker', '. 0 . 0 . 0 . 0 . 0 . 0 . 0 . 0', { drop: 0.18, minIntensity: 0.5 }),
        track('sub', 'sub', '0 . . . . . . . 0 . . . . . 7 .'),
        track('stab', 'stab', '. . . . . . 24 . . . . . . . 22 .', { bars: [0, 2], minIntensity: 0.4 }),
      ],
    },
  },
  {
    id: 'kettle', name: 'Kettle', bed: 'night', bedLevel: 0.55, bedTone: 0.3,
    note: 'Seventy-two, almost no percussion, and a drone that changes once a bar. Written to be ' +
      'left on: there is nothing here for the ear to learn and then resent.',
    instruments: { drone: 'drone', bell: 'bell', pluck: 'pluck', shaker: 'shaker', sub: 'sub' },
    song: {
      bpm: 72, steps: 16, rootHz: 55, seed: 19, progression: [0, 5, -2, -5],
      tracks: [
        track('drone', 'drone', '12 . . . . . . . . . . . . . . .'),
        track('sub', 'sub', '. . . . . . . . 0 . . . . . . .', { minIntensity: 0.3 }),
        track('bell', 'bell', '. . . . 36 . . . . . . . . . 43 .', { drop: 0.18, bars: [0, 2] }),
        track('pluck', 'pluck', '. . 31 . . . . . . . 36 . . . . .', { drop: 0.15, bars: [1, 3], minIntensity: 0.45 }),
        track('shaker', 'shaker', '. . . . . . . 0 . . . . . . . 0', { drop: 0.25, minIntensity: 0.65 }),
      ],
    },
  },
  {
    id: 'parade', name: 'Parade', bed: 'room', bedLevel: 0.25, bedTone: 0.9,
    note: 'C–G–Am–F, bright, a hundred and twelve. The arp is the only track speaking on more than ' +
      'a third of the steps and it drops one note in five to keep the bar from repeating.',
    instruments: { kick: 'kick', clap: 'clap', hat: 'hat', bass: 'bass', pluck: 'pluck', arp: 'arp' },
    song: {
      bpm: 112, steps: 16, rootHz: 65.41, seed: 23, progression: [0, 7, 9, 5],
      tracks: [
        track('kick', 'kick', '0 . . . . . 0 . . . 0 . . . . .'),
        track('clap', 'clap', '. . . . 0 . . . . . . . 0 . . .'),
        track('hat', 'hat', '0 . 0 . 0 . 0 . 0 . 0 . 0 . 0 .', { drop: 0.1 }),
        track('bass', 'bass', '0 . . . 0 . . . 7 . . . 5 . . .'),
        track('pluck', 'pluck', '. . . . 24 . . . . . . . 28 . . .', { minIntensity: 0.3 }),
        track('arp', 'arp', '. 24 . 28 . 31 . 28 . 24 . 28 . 31 . 36', { drop: 0.2, bars: [1, 3], minIntensity: 0.55 }),
      ],
    },
  },
  {
    id: 'cellar', name: 'Cellar', bed: 'sea', bedLevel: 0.45, bedTone: 0.4,
    note: 'Dub weight: everything on the one, the stab on the and, and a very long sub. Turn the ' +
      'intensity down and it becomes almost nothing, which is what it is for.',
    instruments: { thud: 'thud', rim: 'rim', sub: 'sub', stab: 'stab', pad: 'pad', 'open-hat': 'open-hat' },
    song: {
      bpm: 100, steps: 16, rootHz: 55, seed: 41, progression: [0, 0, 5, 3],
      tracks: [
        track('thud', 'thud', '0 . . . . . . . . . 0 . . . . .'),
        track('rim', 'rim', '. . . . . . . . 0 . . . . . . .'),
        track('open-hat', 'open-hat', '. . . . . . 0 . . . . . . . 0 .', { drop: 0.2, minIntensity: 0.4 }),
        track('sub', 'sub', '0 . . . . . . . . . . . . . . .'),
        track('stab', 'stab', '. . . . . . 27 . . . . . . . 24 .', { drop: 0.15, bars: [0, 1, 3], minIntensity: 0.3 }),
        track('pad', 'pad', '. . . . . . . . 12 . . . . . . .', { minIntensity: 0.65 }),
      ],
    },
  },
];

export const PATTERN_BY_ID: ReadonlyMap<string, Pattern> = new Map(PATTERNS.map((p) => [p.id, p]));
