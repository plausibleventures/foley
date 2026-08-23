/**
 * The beds — the continuous half.
 *
 * A loop wears out because it is the same loop regardless of what happened; a texture does not,
 * because there is nothing in it to learn. Every bed here is driven by two numbers: `level`, how
 * much of it is running, and `tone`, what kind of place it is. Level scales gain and opens the
 * filters, so an empty room is *silent* rather than quiet; tone sags the pitch, closes the top
 * and crossfades the banded layers past each other.
 *
 * Two things are deliberate and both are traps the package documents. Bands **overlap**: two
 * layers written `[0, 0.5]` and `[0.55, 1]` leave a hole at 0.52 that a listener walks into and
 * hears as the sound breaking. And any bed with a layer under about 60 Hz gets a shallow `sagTo`,
 * because the default sag of 0.55 takes a 41 Hz layer down to 22 Hz — under the floor the
 * one-shot validator refuses, and inaudible on anything but headphones.
 */

import type { BedLayer, BedOptions } from '@latticekit/audio';

export interface BedPreset {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly layers: readonly BedLayer[];
  readonly options?: BedOptions;
}

export const BEDS: readonly BedPreset[] = [
  {
    id: 'none', name: 'None', note: 'Nothing underneath. The sequencer on its own.',
    layers: [],
  },
  {
    id: 'room', name: 'Room', note: 'Air and a little mains hum. What a quiet room actually sounds like when you stop talking.',
    options: { sagTo: 0.85, glideSec: 1.4 },
    layers: [
      { wave: 'noise', hz: 0, gain: 0.055, cutoff: 420, cutoffAtFull: 3.2 },
      { wave: 'sine', hz: 50, gain: 0.045, cutoff: 200, cutoffAtFull: 1.4 },
      { wave: 'sine', hz: 50, gain: 0.03, cutoff: 200, cutoffAtFull: 1.4, beat: 0.3 },
    ],
  },
  {
    id: 'rain', name: 'Rain', note: 'Filtered noise on two bands. Nobody has ever been annoyed by rain, which is the entire argument for beds.',
    options: { sagTo: 0.8, glideSec: 2.2 },
    layers: [
      { wave: 'noise', hz: 0, gain: 0.075, cutoff: 900, cutoffAtFull: 4.5 },
      { wave: 'noise', hz: 0, gain: 0.05, cutoff: 260, cutoffAtFull: 2.4, band: [0, 0.6] },
      { wave: 'sine', hz: 62, gain: 0.035, cutoff: 240, cutoffAtFull: 1.6 },
    ],
  },
  {
    id: 'plant', name: 'Plant', note: 'Machinery. Two near-identical low sines a third of a hertz apart, which beat against each other the way real plant never quite runs in phase.',
    options: { sagTo: 0.82, glideSec: 1.1 },
    layers: [
      { wave: 'sine', hz: 44, gain: 0.09, cutoff: 220, cutoffAtFull: 1.5 },
      { wave: 'sine', hz: 44, gain: 0.07, cutoff: 220, cutoffAtFull: 1.5, beat: 0.33 },
      { wave: 'sine', hz: 88, gain: 0.04, cutoff: 400, cutoffAtFull: 2.2, band: [0.4, 1] },
      { wave: 'noise', hz: 0, gain: 0.04, cutoff: 700, cutoffAtFull: 3.4, band: [0.35, 1] },
    ],
  },
  {
    id: 'night', name: 'Night', note: 'Two layers trading places rather than one filter sweeping: coil whine on the high band, something chirping on the low one. A sweep sounds like a sweep; a crossfade sounds like evening.',
    options: { sagTo: 0.8, glideSec: 2.6 },
    layers: [
      { wave: 'noise', hz: 0, gain: 0.035, cutoff: 2600, cutoffAtFull: 2.2, band: [0, 0.58] },
      { wave: 'sine', hz: 1180, gain: 0.018, cutoff: 3000, cutoffAtFull: 1.2, band: [0.42, 1] },
      { wave: 'sine', hz: 58, gain: 0.05, cutoff: 220, cutoffAtFull: 1.4 },
      { wave: 'noise', hz: 0, gain: 0.03, cutoff: 340, cutoffAtFull: 2.6 },
    ],
  },
  {
    id: 'sea', name: 'Sea', note: 'Very slow, very wide. The two-and-a-half second glide is what makes level changes read as swell rather than as somebody moving a fader.',
    options: { sagTo: 0.8, glideSec: 2.8 },
    layers: [
      { wave: 'noise', hz: 0, gain: 0.085, cutoff: 500, cutoffAtFull: 4.0 },
      { wave: 'noise', hz: 0, gain: 0.04, cutoff: 180, cutoffAtFull: 2.0, band: [0, 0.65] },
      { wave: 'sine', hz: 41, gain: 0.05, cutoff: 180, cutoffAtFull: 1.3 },
    ],
  },
  {
    id: 'signal', name: 'Signal', note: 'A carrier and its neighbour, high and thin. The one bed here that is uncomfortable on purpose.',
    options: { sagTo: 0.7, glideSec: 0.8 },
    layers: [
      { wave: 'sine', hz: 440, gain: 0.022, cutoff: 1400, cutoffAtFull: 1.6 },
      { wave: 'sine', hz: 440, gain: 0.018, cutoff: 1400, cutoffAtFull: 1.6, beat: 1.7 },
      { wave: 'noise', hz: 0, gain: 0.03, cutoff: 3200, cutoffAtFull: 2.4, band: [0.45, 1] },
      { wave: 'sine', hz: 110, gain: 0.04, cutoff: 300, cutoffAtFull: 1.4, band: [0, 0.62] },
    ],
  },
];

export const BED_BY_ID: ReadonlyMap<string, BedPreset> = new Map(BEDS.map((b) => [b.id, b]));
