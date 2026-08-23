/**
 * The instrument palette.
 *
 * A `TrackVoice` has no pitch of its own — the sequencer supplies that from the bar's chord —
 * which is why one progression can move every melodic track at once and why percussion has to
 * opt out with `fixedHz`. That single distinction is most of what separates the two halves of
 * this list.
 *
 * The gains look small. They are: the deck's own validator holds any one step to a summed 0.5,
 * on the argument that a theme competing with the sounds that carry information is a theme that
 * gets the whole app muted. Four instruments landing on the downbeat is most of that budget.
 */

import type { TrackVoice } from '@latticekit/audio';

export interface Instrument {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly kind: 'drum' | 'bass' | 'lead' | 'air';
  /** False for percussion: it does not follow the harmony, and it is exempt from the rest rule. */
  readonly melodic: boolean;
  readonly voice: TrackVoice;
}

export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: 'kick', name: 'Kick', kind: 'drum', melodic: false,
    note: 'A sine at 120 Hz swept down to a third of itself in a tenth of a second. There is no ' +
      'other way to get a kick out of an oscillator, and no sample here to fall back on.',
    voice: { wave: 'sine', gain: 0.17, hold: 0.13, cutoff: 340, sweepTo: 0.34, fixedHz: 120 },
  },
  {
    id: 'thud', name: 'Thud', kind: 'drum', melodic: false,
    note: 'The same trick lower and longer. Felt more than heard on a laptop; the one to use if ' +
      'the track is going to be listened to on anything with a woofer.',
    voice: { wave: 'sine', gain: 0.18, hold: 0.22, cutoff: 200, sweepTo: 0.26, fixedHz: 92 },
  },
  {
    id: 'snare', name: 'Snare', kind: 'drum', melodic: false,
    note: 'Noise through a high-pass. The corner is the whole instrument: below about a kilohertz ' +
      'it stops being a snare and starts being a cough.',
    voice: { wave: 'noise', gain: 0.11, hold: 0.13, cutoff: 5400, highpass: 1100 },
  },
  {
    id: 'clap', name: 'Clap', kind: 'drum', melodic: false,
    note: 'A snare with the attack slowed to twelve milliseconds, which is enough for the ear to ' +
      'hear a smear of hands rather than a single hit.',
    voice: { wave: 'noise', gain: 0.10, hold: 0.11, cutoff: 4200, highpass: 900, attack: 0.012 },
  },
  {
    id: 'rim', name: 'Rim', kind: 'drum', melodic: false,
    note: 'Twenty-eight milliseconds of bright noise. Sits in the gap between a hat and a snare ' +
      'without asking for either of their frequencies.',
    voice: { wave: 'noise', gain: 0.075, hold: 0.028, cutoff: 9000, highpass: 2600 },
  },
  {
    id: 'hat', name: 'Hat', kind: 'drum', melodic: false,
    note: 'The thing a listener stops hearing and starts moving to. It is exempt from the rest ' +
      'rule for exactly that reason — a hat on every step is correct and a lead on every step is not.',
    voice: { wave: 'noise', gain: 0.045, hold: 0.035, highpass: 7200 },
  },
  {
    id: 'open-hat', name: 'Open hat', kind: 'drum', melodic: false,
    note: 'The same noise held five times as long. Two of these in a bar is a groove; four is a hiss.',
    voice: { wave: 'noise', gain: 0.05, hold: 0.19, highpass: 6000 },
  },
  {
    id: 'shaker', name: 'Shaker', kind: 'drum', melodic: false,
    note: 'High, soft-edged, and quiet enough to run underneath everything without ever being the ' +
      'thing you notice.',
    voice: { wave: 'noise', gain: 0.04, hold: 0.06, cutoff: 12000, highpass: 4200, attack: 0.012 },
  },
  {
    id: 'tom', name: 'Tom', kind: 'drum', melodic: false,
    note: 'Tuned percussion: a triangle at 190 Hz falling to two thirds. Ignores the chord, like ' +
      'everything else with a fixed pitch.',
    voice: { wave: 'triangle', gain: 0.11, hold: 0.18, cutoff: 900, sweepTo: 0.62, fixedHz: 190 },
  },
  {
    id: 'bass', name: 'Bass', kind: 'bass', melodic: true,
    note: 'A triangle under a low corner. Triangle rather than sine because a sine bass vanishes ' +
      'on a phone speaker, and rather than saw because a saw bass fights the pads.',
    voice: { wave: 'triangle', gain: 0.12, hold: 0.26, cutoff: 420 },
  },
  {
    id: 'sub', name: 'Sub', kind: 'bass', melodic: true,
    note: 'One sine, almost no top end, long hold. The floor of the mix.',
    voice: { wave: 'sine', gain: 0.13, hold: 0.42, cutoff: 190 },
  },
  {
    id: 'pluck', name: 'Pluck', kind: 'lead', melodic: true,
    note: 'Short, bright, and the safest melodic voice here: at this hold nothing overlaps enough ' +
      'to sum into a clip.',
    voice: { wave: 'triangle', gain: 0.09, hold: 0.17, cutoff: 2400 },
  },
  {
    id: 'keys', name: 'Keys', kind: 'lead', melodic: true,
    note: 'A square wave with most of its top removed. What is left of a square under a low corner ' +
      'is a hollow, reedy thing that reads as an instrument rather than as a synthesiser.',
    voice: { wave: 'square', gain: 0.06, hold: 0.24, cutoff: 1300 },
  },
  {
    id: 'stab', name: 'Stab', kind: 'lead', melodic: true,
    note: 'A sawtooth clipped short. Put it on the offbeat and it does the work a whole rhythm ' +
      'section would otherwise have to.',
    voice: { wave: 'sawtooth', gain: 0.08, hold: 0.14, cutoff: 1500 },
  },
  {
    id: 'bell', name: 'Bell', kind: 'lead', melodic: true,
    note: 'A sine allowed to ring for the best part of a second. Use two notes of it per bar at most.',
    voice: { wave: 'sine', gain: 0.07, hold: 0.85, cutoff: 3400 },
  },
  {
    id: 'arp', name: 'Arp', kind: 'lead', melodic: true,
    note: 'A fast triangle for running figures. Give it a drop so the same sixteen steps are not ' +
      'the same sixteen steps every bar.',
    voice: { wave: 'triangle', gain: 0.07, hold: 0.10, cutoff: 2800 },
  },
  {
    id: 'pad', name: 'Pad', kind: 'air', melodic: true,
    note: 'A sawtooth with a three-hundred-millisecond attack under a low corner. The attack is ' +
      'the entire difference between a pad and a stab; the waveform is the same.',
    voice: { wave: 'sawtooth', gain: 0.055, hold: 1.7, cutoff: 780, attack: 0.3 },
  },
  {
    id: 'drone', name: 'Drone', kind: 'air', melodic: true,
    note: 'A held sine two octaves down. One note a bar, and the bar stops sounding like it began.',
    voice: { wave: 'sine', gain: 0.06, hold: 2.4, cutoff: 500, attack: 0.5 },
  },
];

export const INSTRUMENT_BY_ID: ReadonlyMap<string, Instrument> = new Map(INSTRUMENTS.map((i) => [i.id, i]));
