/**
 * The kit: twenty-four interface sounds that are one family rather than twenty-four files.
 *
 * ## Why a kit is generated and not typed out
 *
 * The thing that separates a designed set of interface sounds from a folder of downloads is
 * that the designed set is *in one key and one material*. A confirm and an error that were
 * chosen separately are two sounds; a confirm a fifth above the error, struck on the same
 * imagined object, are one voice saying two things. Nobody hears the interval consciously and
 * everybody hears when it is missing.
 *
 * So no sound here carries a frequency. Each is a **sketch**: intervals above the kit's root,
 * roles rather than waveforms, and holds in multiples rather than seconds. A {@link Voicing}
 * says what the imagined object is made of and the axes say how hard it was struck, and between
 * them they turn twenty-four sketches into a `SoundDef` table the engine can play.
 *
 * ## Where the range actually comes from
 *
 * Not from the sliders. Five voicings differ in the one thing a slider cannot reach: **which
 * partials are there at all**. A struck bell is famously inharmonic — its partials sit near 2.76
 * and 5.4 times the fundamental, ratios that are not any interval in any scale — and that, not
 * its brightness, is why a bell is a bell. Glass is harmonic (2, 3) and reads as a tuned tone;
 * wood is 2.4 and 3.9 and reads as a block; rubber has no partials at all and reads as a thumb
 * on a table. Move every slider to its limit and a glass tap never becomes a bell, which is the
 * point: the sliders are how hard you hit it, and the voicing is what you hit.
 */

import { SEMITONE } from '@latticekit/audio';
import type { Layer, SoundDef, Wave } from '@latticekit/audio';

/* --------------------------------------------------------------------------------------------
   The sounds, as sketches
   -------------------------------------------------------------------------------------------- */

/**
 * What a layer is *for*. The role picks the waveform, the filter and the gain trim out of the
 * voicing, so a sketch never names a wave and swapping the material rewrites all twenty-four
 * sounds at once.
 */
type Role =
  /** The pitch you actually hear. */
  | 'tone'
  /** A partial above the fundamental, at the voicing's own ratio — harmonic or not. */
  | 'partial'
  /** An octave or two under the tone. Weight, not pitch. */
  | 'sub'
  /** Filtered noise: air, a rush, the body of a knock. */
  | 'noise'
  /** The four milliseconds of broadband at the very front that make a sound feel like contact. */
  | 'click';

interface SketchLayer {
  readonly role: Role;
  /** Semitones above the kit root. Ignored by `noise` and `click`. */
  readonly semis?: number;
  /** Glide to this interval instead. Depth is scaled by the `sweep` axis. */
  readonly toSemis?: number;
  /** Octave shift applied after `semis`. */
  readonly octave?: number;
  /** Which of the voicing's partial ratios, for the `partial` role. */
  readonly partial?: number;
  /** Relative loudness inside the sound, before every axis. */
  readonly gain: number;
  /** Seconds of decay, before the voicing's and the `body` axis's multipliers. */
  readonly hold: number;
  /** Seconds before this layer speaks. This is what arpeggiates a chord. */
  readonly delay?: number;
  /** Multiplier on the attack the axes produced. Above 1 for a swell, below for a snap. */
  readonly attack?: number;
  /** Multiplier on the low-pass corner the voicing and the `brightness` axis produced. */
  readonly cutoff?: number;
  /** High-pass corner in Hz, absolute. Only noise ever wants one. */
  readonly highpass?: number;
  /** Static pan. Reserved for the two sounds that are *about* direction. */
  readonly pan?: number;
}

export interface Sketch {
  readonly id: string;
  /** What it is called in the file you download. */
  readonly label: string;
  /** What it is for, in the one line a designer needs to pick it. */
  readonly note: string;
  readonly group: 'touch' | 'outcome' | 'motion' | 'state';
  readonly bus: 'ui' | 'sfx';
  readonly minGapMs: number;
  readonly ladder?: { readonly steps: number; readonly windowMs: number };
  readonly layers: readonly SketchLayer[];
}

/**
 * The twenty-four.
 *
 * The intervals are the argument. Everything that means *yes* rises through a major triad
 * (0, 4, 7); everything that means *no* falls, and falls by a minor second or a tritone, the two
 * intervals a listener reads as wrong without being able to name them. Anything reversible —
 * open and close, send and receive, on and off — is the same two notes in the other order, so a
 * user learns half the kit by hearing the other half.
 */
export const SKETCHES: readonly Sketch[] = [
  // ---- touch --------------------------------------------------------------------------------
  {
    id: 'tap', label: 'tap', group: 'touch', bus: 'ui', minGapMs: 40,
    note: 'The neutral one. Everything that is only an acknowledgement.',
    ladder: { steps: 4, windowMs: 700 },
    layers: [
      { role: 'tone', semis: 0, octave: 1, gain: 0.20, hold: 0.035 },
      { role: 'click', gain: 0.06, hold: 0.006, highpass: 3000 },
    ],
  },
  {
    id: 'press', label: 'press', group: 'touch', bus: 'ui', minGapMs: 45,
    note: 'Finger down. Lower than the tap so a press-and-release reads as a pair.',
    layers: [
      { role: 'tone', semis: -5, gain: 0.20, hold: 0.045, cutoff: 0.8 },
      { role: 'sub', semis: -5, octave: -1, gain: 0.10, hold: 0.05 },
      { role: 'click', gain: 0.05, hold: 0.005, highpass: 2400 },
    ],
  },
  {
    id: 'release', label: 'release', group: 'touch', bus: 'ui', minGapMs: 45,
    note: 'Finger up. Quieter and a fourth higher: the answer to press, never the same size.',
    layers: [
      { role: 'tone', semis: 0, gain: 0.13, hold: 0.03, cutoff: 1.1 },
      { role: 'click', gain: 0.03, hold: 0.004, highpass: 3600 },
    ],
  },
  {
    id: 'hover', label: 'hover', group: 'touch', bus: 'ui', minGapMs: 90,
    note: 'Barely there. For a cursor crossing something, where anything louder becomes a rattle.',
    layers: [
      { role: 'tone', semis: 12, octave: 1, gain: 0.055, hold: 0.018, cutoff: 1.3 },
    ],
  },
  {
    id: 'type', label: 'type', group: 'touch', bus: 'ui', minGapMs: 28,
    note: 'A key. Mostly body, almost no pitch, and it climbs a little as you keep going.',
    ladder: { steps: 5, windowMs: 500 },
    layers: [
      { role: 'noise', gain: 0.09, hold: 0.014, highpass: 900, cutoff: 0.7 },
      { role: 'tone', semis: -12, gain: 0.10, hold: 0.02, cutoff: 0.55 },
    ],
  },
  {
    id: 'select', label: 'select', group: 'touch', bus: 'ui', minGapMs: 55,
    note: 'One item picked out of many. A fifth over the tap, so a list feels tuned.',
    ladder: { steps: 3, windowMs: 620 },
    layers: [
      { role: 'tone', semis: 7, octave: 1, gain: 0.17, hold: 0.04 },
      { role: 'partial', semis: 7, octave: 1, partial: 0, gain: 0.06, hold: 0.05 },
    ],
  },

  // ---- outcome ------------------------------------------------------------------------------
  {
    id: 'confirm', label: 'confirm', group: 'outcome', bus: 'ui', minGapMs: 140,
    note: 'Small yes. Two notes up a fifth — the shortest phrase that can mean it worked.',
    layers: [
      { role: 'tone', semis: 0, gain: 0.16, hold: 0.07 },
      { role: 'tone', semis: 7, gain: 0.16, hold: 0.12, delay: 0.055 },
      { role: 'partial', semis: 7, partial: 0, gain: 0.05, hold: 0.14, delay: 0.055 },
    ],
  },
  {
    id: 'success', label: 'success', group: 'outcome', bus: 'ui', minGapMs: 260,
    note: 'The big one. A major triad walked up and left ringing. Use it rarely or it stops meaning anything.',
    layers: [
      { role: 'tone', semis: 0, gain: 0.15, hold: 0.10 },
      { role: 'tone', semis: 4, gain: 0.15, hold: 0.12, delay: 0.070 },
      { role: 'tone', semis: 7, gain: 0.15, hold: 0.16, delay: 0.140 },
      { role: 'tone', semis: 12, gain: 0.13, hold: 0.34, delay: 0.210 },
      { role: 'partial', semis: 12, partial: 0, gain: 0.05, hold: 0.40, delay: 0.210 },
    ],
  },
  {
    id: 'error', label: 'error', group: 'outcome', bus: 'ui', minGapMs: 260,
    note: 'A minor second, falling. The interval a listener hears as wrong without knowing why.',
    layers: [
      { role: 'tone', semis: 1, gain: 0.17, hold: 0.09, cutoff: 0.55 },
      { role: 'tone', semis: 0, gain: 0.18, hold: 0.22, delay: 0.085, cutoff: 0.5 },
      { role: 'sub', semis: 0, octave: -1, gain: 0.10, hold: 0.24, delay: 0.085 },
    ],
  },
  {
    id: 'deny', label: 'deny', group: 'outcome', bus: 'ui', minGapMs: 160,
    note: 'The locked door. No pitch movement at all — refusal is the absence of an answer.',
    layers: [
      { role: 'tone', semis: -12, gain: 0.20, hold: 0.075, cutoff: 0.32 },
      { role: 'noise', gain: 0.07, hold: 0.05, cutoff: 0.22 },
    ],
  },
  {
    id: 'warn', label: 'warn', group: 'outcome', bus: 'ui', minGapMs: 500,
    note: 'Two pulses on a tritone. Loud enough to interrupt, dark enough not to sting.',
    layers: [
      { role: 'tone', semis: -6, gain: 0.17, hold: 0.10, cutoff: 0.6 },
      { role: 'tone', semis: -6, gain: 0.17, hold: 0.16, delay: 0.185, cutoff: 0.6 },
      { role: 'sub', semis: -6, octave: -1, gain: 0.08, hold: 0.20, delay: 0.185 },
    ],
  },
  {
    id: 'complete', label: 'complete', group: 'outcome', bus: 'ui', minGapMs: 400,
    note: 'The long job finished. Slower and wider than confirm, because it is allowed to take its time.',
    layers: [
      { role: 'tone', semis: 0, gain: 0.13, hold: 0.16, attack: 2.4 },
      { role: 'tone', semis: 7, gain: 0.13, hold: 0.22, delay: 0.130, attack: 2.4 },
      { role: 'tone', semis: 16, gain: 0.12, hold: 0.55, delay: 0.260, attack: 3.2 },
      { role: 'partial', semis: 16, partial: 0, gain: 0.045, hold: 0.60, delay: 0.260 },
    ],
  },

  // ---- motion -------------------------------------------------------------------------------
  {
    id: 'open', label: 'open', group: 'motion', bus: 'ui', minGapMs: 150,
    note: 'A panel arriving. Rises a fifth and brings air with it.',
    layers: [
      { role: 'tone', semis: 0, toSemis: 7, gain: 0.14, hold: 0.16, attack: 2.0, cutoff: 1.2 },
      { role: 'noise', gain: 0.07, hold: 0.13, attack: 4.0, highpass: 700, cutoff: 1.4 },
    ],
  },
  {
    id: 'close', label: 'close', group: 'motion', bus: 'ui', minGapMs: 150,
    note: 'The same gesture backwards, and shorter — leaving is always quicker than arriving.',
    layers: [
      { role: 'tone', semis: 7, toSemis: 0, gain: 0.14, hold: 0.11, cutoff: 0.85 },
      { role: 'noise', gain: 0.055, hold: 0.08, highpass: 500, cutoff: 0.8 },
    ],
  },
  {
    id: 'swipe', label: 'swipe', group: 'motion', bus: 'sfx', minGapMs: 90,
    note: 'Something moved past. Almost all noise, and panned, because a swipe has a direction.',
    layers: [
      { role: 'noise', gain: 0.10, hold: 0.10, attack: 3.0, highpass: 400, cutoff: 1.1, pan: -0.45 },
      { role: 'noise', gain: 0.07, hold: 0.07, delay: 0.045, highpass: 900, cutoff: 1.3, pan: 0.45 },
    ],
  },
  {
    id: 'send', label: 'send', group: 'motion', bus: 'ui', minGapMs: 180,
    note: 'It left. A tick and then a rise that thins out as it goes away.',
    layers: [
      { role: 'click', gain: 0.055, hold: 0.006, highpass: 2600 },
      { role: 'tone', semis: 0, toSemis: 19, gain: 0.13, hold: 0.20, cutoff: 1.3 },
      { role: 'noise', gain: 0.045, hold: 0.16, delay: 0.02, highpass: 1600, cutoff: 1.6 },
    ],
  },
  {
    id: 'receive', label: 'receive', group: 'motion', bus: 'ui', minGapMs: 180,
    note: 'It landed. Falls into the note rather than climbing off it, and then settles.',
    layers: [
      { role: 'tone', semis: 19, toSemis: 7, gain: 0.12, hold: 0.14, cutoff: 1.2 },
      { role: 'tone', semis: 7, gain: 0.13, hold: 0.24, delay: 0.115 },
      { role: 'partial', semis: 7, partial: 0, gain: 0.045, hold: 0.26, delay: 0.115 },
    ],
  },
  {
    id: 'arrive', label: 'arrive', group: 'motion', bus: 'ui', minGapMs: 600,
    note: 'The notification. Two struck notes and a tail — the one sound here allowed to ring.',
    layers: [
      { role: 'tone', semis: 12, gain: 0.14, hold: 0.22 },
      { role: 'tone', semis: 19, gain: 0.13, hold: 0.75, delay: 0.155 },
      { role: 'partial', semis: 12, partial: 0, gain: 0.055, hold: 0.55 },
      { role: 'partial', semis: 19, partial: 1, gain: 0.035, hold: 0.85, delay: 0.155 },
    ],
  },

  // ---- state --------------------------------------------------------------------------------
  {
    id: 'toggle-on', label: 'toggle-on', group: 'state', bus: 'ui', minGapMs: 90,
    note: 'Switch up. Two notes, low then high, and the click of the mechanism under them.',
    layers: [
      { role: 'click', gain: 0.05, hold: 0.005, highpass: 2200 },
      { role: 'tone', semis: 0, gain: 0.14, hold: 0.035 },
      { role: 'tone', semis: 7, gain: 0.15, hold: 0.075, delay: 0.045 },
    ],
  },
  {
    id: 'toggle-off', label: 'toggle-off', group: 'state', bus: 'ui', minGapMs: 90,
    note: 'Switch down. The identical pair, reversed, and a shade duller.',
    layers: [
      { role: 'click', gain: 0.05, hold: 0.005, highpass: 2200 },
      { role: 'tone', semis: 7, gain: 0.14, hold: 0.035, cutoff: 0.8 },
      { role: 'tone', semis: 0, gain: 0.15, hold: 0.075, delay: 0.045, cutoff: 0.75 },
    ],
  },
  {
    id: 'unlock', label: 'unlock', group: 'state', bus: 'ui', minGapMs: 350,
    note: 'A mechanism giving way: two clicks that are not evenly spaced, then the tone underneath.',
    layers: [
      { role: 'click', gain: 0.06, hold: 0.006, highpass: 2000 },
      { role: 'click', gain: 0.055, hold: 0.007, delay: 0.062, highpass: 2600 },
      { role: 'tone', semis: 0, toSemis: 12, gain: 0.13, hold: 0.22, delay: 0.075 },
    ],
  },
  {
    id: 'lock', label: 'lock', group: 'state', bus: 'ui', minGapMs: 240,
    note: 'The same mechanism closing. Two even clicks — a lock is regular where a release is not — over a tone that falls.',
    layers: [
      { role: 'click', gain: 0.055, hold: 0.006, highpass: 2000 },
      { role: 'click', gain: 0.055, hold: 0.007, delay: 0.075, highpass: 2000 },
      { role: 'tone', semis: 12, toSemis: 0, gain: 0.12, hold: 0.14, delay: 0.02, cutoff: 0.7 },
    ],
  },
  {
    id: 'delete', label: 'delete', group: 'state', bus: 'sfx', minGapMs: 220,
    note: 'Gone. A downward sweep through noise — the only sound in the kit that ends darker than it began.',
    layers: [
      { role: 'noise', gain: 0.10, hold: 0.13, highpass: 300, cutoff: 0.45 },
      { role: 'tone', semis: 0, toSemis: -19, gain: 0.13, hold: 0.15, cutoff: 0.6 },
    ],
  },
  {
    id: 'capture', label: 'capture', group: 'state', bus: 'sfx', minGapMs: 260,
    note: 'A shutter. Two noise bursts forty milliseconds apart, which is the whole trick.',
    layers: [
      { role: 'noise', gain: 0.11, hold: 0.012, highpass: 1400, cutoff: 1.4 },
      { role: 'noise', gain: 0.09, hold: 0.035, delay: 0.042, highpass: 900, cutoff: 1.1 },
      { role: 'tone', semis: -12, gain: 0.07, hold: 0.03, delay: 0.042, cutoff: 0.4 },
    ],
  },
];

export type SoundId = string;

export const SKETCH_BY_ID: ReadonlyMap<string, Sketch> = new Map(SKETCHES.map((s) => [s.id, s]));

export const GROUPS = [
  { id: 'touch', label: 'Touch', note: 'Contact. Short, quiet, and the ones a user hears hundreds of times a day.' },
  { id: 'outcome', label: 'Outcome', note: 'Yes and no. Rising means it worked; falling means it did not.' },
  { id: 'motion', label: 'Motion', note: 'Something moved, arrived or left, and the sound says which direction.' },
  { id: 'state', label: 'State', note: 'A thing changed and stayed changed.' },
] as const;

/* --------------------------------------------------------------------------------------------
   The voicings — what the imagined object is made of
   -------------------------------------------------------------------------------------------- */

export interface Voicing {
  readonly id: string;
  readonly name: string;
  /** The one-line pitch, on the button. */
  readonly tag: string;
  /** What it actually is, in the panel. */
  readonly blurb: string;
  readonly tone: Wave;
  readonly sub: Wave;
  /** Frequency ratios of the partials. Harmonic ones are integers; the interesting ones are not. */
  readonly partials: readonly number[];
  /** Low-pass corner in Hz at `brightness` 0.5. */
  readonly cutoff: number;
  /** Multiplier on every sketch hold. */
  readonly hold: number;
  /** Attack in seconds at `attack` 0.5. */
  readonly attack: number;
  readonly noiseGain: number;
  readonly partialGain: number;
  /**
   * Fraction the tone glides by over its own life, on layers that do not glide already. A struck
   * wooden block drops slightly as it decays and a breath rises; a bell does neither.
   */
  readonly drift: number;
}

export const VOICINGS: readonly Voicing[] = [
  {
    id: 'glass', name: 'Glass', tag: 'harmonic, clean, modern',
    blurb:
      'A tuned sine with harmonic partials at twice and three times the fundamental. Harmonic ' +
      'partials are what the ear hears as one pitch rather than as a noise with a note in it, ' +
      'so this is the voicing that disappears into an interface: present, tuned, and never the ' +
      'thing you notice.',
    tone: 'sine', sub: 'sine', partials: [2, 3], cutoff: 5200, hold: 1.0, attack: 0.005,
    noiseGain: 0.55, partialGain: 0.55, drift: 0,
  },
  {
    id: 'wood', name: 'Wood', tag: 'dry, blunt, close',
    blurb:
      'A triangle with partials at 2.4 and 3.9 — near-misses of the octave and the twelfth, which ' +
      'is what a struck block actually does. Short holds and a low corner: nothing rings, ' +
      'everything stops. The voicing for an interface that should feel like objects rather than ' +
      'like software.',
    tone: 'triangle', sub: 'triangle', partials: [2.4, 3.9], cutoff: 2400, hold: 0.68, attack: 0.004,
    noiseGain: 1.0, partialGain: 0.38, drift: -0.03,
  },
  {
    id: 'rubber', name: 'Rubber', tag: 'soft, dull, no partials at all',
    blurb:
      'One sine, no partials, a low corner and a downward drift. It is the quietest voicing here ' +
      'and the least tiring — a thumb on a table rather than a struck thing. If the kit is going ' +
      'into something people use all day, start here and turn the brightness down further.',
    tone: 'sine', sub: 'sine', partials: [], cutoff: 1350, hold: 0.9, attack: 0.009,
    noiseGain: 0.4, partialGain: 0, drift: -0.07,
  },
  {
    id: 'metal', name: 'Metal', tag: 'inharmonic, bright, rings',
    blurb:
      'Partials at 2.76 and 5.4 times the fundamental — the ratios of a real bell, which belong ' +
      'to no scale and are exactly why a bell sounds struck rather than played. Long holds and a ' +
      'high corner. Nothing else in this tool will get you a bell, and no slider on any of the ' +
      'others will get you close.',
    tone: 'triangle', sub: 'sine', partials: [2.76, 5.4], cutoff: 6800, hold: 1.7, attack: 0.003,
    noiseGain: 0.75, partialGain: 0.5, drift: 0,
  },
  {
    id: 'vapour', name: 'Vapour', tag: 'breathed rather than struck',
    blurb:
      'A slow attack, a single octave partial and a lot of air. Past about thirty milliseconds an ' +
      'onset stops reading as caused by the press and starts reading as a notification about it — ' +
      'this voicing lives on the far side of that line deliberately. For calm software, and wrong ' +
      'for anything that needs to feel responsive.',
    tone: 'sine', sub: 'sine', partials: [2], cutoff: 1900, hold: 2.0, attack: 0.05,
    noiseGain: 1.35, partialGain: 0.3, drift: 0.035,
  },
];

export const VOICING_BY_ID: ReadonlyMap<string, Voicing> = new Map(VOICINGS.map((v) => [v.id, v]));

/* --------------------------------------------------------------------------------------------
   The axes
   -------------------------------------------------------------------------------------------- */

export interface AxisDef {
  readonly id: keyof Axes;
  readonly label: string;
  /** What moving it actually does, in the words of the thing it changes. */
  readonly note: string;
  /** Shown at each end of the track. */
  readonly ends: readonly [string, string];
}

export interface Axes {
  /** Semitones from A4 = 440. The kit's root, and every interval in every sketch is over it. */
  key: number;
  brightness: number;
  body: number;
  attack: number;
  presence: number;
  air: number;
  shimmer: number;
  sweep: number;
}

export const DEFAULT_AXES: Axes = {
  key: 5, // D5
  brightness: 0.5,
  body: 0.5,
  attack: 0.42,
  presence: 0.62,
  air: 0.5,
  shimmer: 0.5,
  sweep: 0.5,
};

export const AXES: readonly AxisDef[] = [
  {
    id: 'brightness', label: 'Brightness', ends: ['muffled', 'glassy'],
    note: 'The low-pass corner on every layer. The single most useful control here, and the one ' +
      'that decides whether a kit is tiring: brightness is what makes a sound cut through, and ' +
      'cutting through is what nobody wants on the four hundredth press.',
  },
  {
    id: 'body', label: 'Body', ends: ['clipped', 'ringing'],
    note: 'How long every decay is. This, and not pitch, is what makes an interface feel fast or ' +
      'slow — a two-hundred-millisecond tap is a tap the user is still hearing when they reach ' +
      'the next control.',
  },
  {
    id: 'attack', label: 'Attack', ends: ['struck', 'breathed'],
    note: 'How long the onset takes. Under about six milliseconds a click comes back on the ' +
      'leading edge, whatever the recipe asked for. Over about thirty, the sound stops reading ' +
      'as caused by the press and starts reading as a notification about it.',
  },
  {
    id: 'presence', label: 'Presence', ends: ['under', 'forward'],
    note: 'Loudness, before the mixer. Layers sum and WebAudio hard-clips above 1, so a dense ' +
      'sound at the top of this range would add past full scale — the generator scales that ' +
      'sound down as a whole rather than letting it distort, which is why the arpeggios stop ' +
      'getting louder before the taps do.',
  },
  {
    id: 'air', label: 'Air', ends: ['none', 'breath'],
    note: 'How much filtered noise sits under the tones. Noise is the whole difference between a ' +
      'tone and a thing being touched; too much and every sound in the kit becomes a cough.',
  },
  {
    id: 'shimmer', label: 'Shimmer', ends: ['fundamental', 'overtones'],
    note: "How loud the voicing's partials are relative to the fundamental. On Metal this is the " +
      'bell control; on Rubber it does nothing at all, because Rubber has no partials to raise.',
  },
  {
    id: 'sweep', label: 'Glide', ends: ['fixed', 'far'],
    note: 'Depth of every pitch glide — the rise in open, the fall in delete. At zero those ' +
      'sounds still play, they just stop moving, and half the kit stops saying which direction ' +
      'the thing went.',
  },
];

/* --------------------------------------------------------------------------------------------
   Building the table
   -------------------------------------------------------------------------------------------- */

/**
 * Equal temperament, walked one multiply at a time.
 *
 * `SEMITONE` is the package's own constant — the twelfth root of two written out rather than
 * computed — and it is exported for exactly this. `Math.pow` is not required by the language spec
 * to be correctly rounded, so a pitch built with it can differ in the last bit between two engines,
 * and two engines that disagree about a frequency cannot be compared in a test.
 */
export function ratioFor(semitones: number): number {
  const whole = Math.trunc(semitones);
  let ratio = 1;
  for (let i = 0; i < Math.abs(whole); i += 1) ratio = whole > 0 ? ratio * SEMITONE : ratio / SEMITONE;
  const fraction = semitones - whole;
  return fraction === 0 ? ratio : ratio * (1 + fraction * (SEMITONE - 1));
}

const NOTE_NAMES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'] as const;

/** `key` is semitones from A4. Names the note the way a musician would, with the octave. */
export function noteName(key: number): string {
  const index = ((key % 12) + 12) % 12;
  // A4 is 440 and C is three semitones above A, so the octave number rolls over at C, not at A.
  const octave = 4 + Math.floor((key + 9) / 12);
  return `${NOTE_NAMES[index]}${String(octave)}`;
}

export function rootHzFor(key: number): number {
  return 440 * ratioFor(key);
}

/** Exponential interpolation: the right shape for anything measured in hertz or in seconds. */
function lerpExp(t: number, low: number, high: number): number {
  return low * Math.pow(high / low, Math.min(1, Math.max(0, t)));
}

export interface KitSpec {
  readonly voicing: string;
  readonly axes: Axes;
}

export const DEFAULT_SPEC: KitSpec = { voicing: 'glass', axes: { ...DEFAULT_AXES } };

/** Under the engine validator's 0.95, with room for the sound that lands on top of this one. */
const CEILING = 0.86;

function clampHz(hz: number): number {
  return Math.min(19000, Math.max(24, hz));
}

/** One sketch plus a voicing plus the axes, resolved into layers the engine can play. */
export function buildSound(sketch: Sketch, spec: KitSpec): SoundDef {
  const voicing = VOICING_BY_ID.get(spec.voicing) ?? VOICINGS[0]!;
  const a = spec.axes;
  const root = rootHzFor(a.key);

  const cutoffBase = voicing.cutoff * lerpExp(a.brightness, 0.34, 2.7);
  const holdScale = voicing.hold * lerpExp(a.body, 0.42, 2.4);
  const attackBase = lerpExp(a.attack, 0.0022, 0.09) * (voicing.attack / 0.005);
  const presence = lerpExp(a.presence, 0.42, 1.55);
  const airScale = a.air * 2 * voicing.noiseGain;
  const shimmerScale = a.shimmer * 1.8 * voicing.partialGain;
  const sweepDepth = a.sweep * 2;

  const layers: Layer[] = [];

  for (const sketch_layer of sketch.layers) {
    const l = sketch_layer;
    const octave = l.octave ?? 0;
    const semis = (l.semis ?? 0) + octave * 12;
    const cutoff = clampHz(cutoffBase * (l.cutoff ?? 1));
    const hold = Math.max(0.004, l.hold * holdScale);
    const attack = Math.max(0.0015, attackBase * (l.attack ?? 1));

    let wave: Wave;
    let hz: number;
    let toHz: number | undefined;
    let gain = l.gain * presence;

    switch (l.role) {
      case 'tone': {
        wave = voicing.tone;
        hz = root * ratioFor(semis);
        // A sketch's own glide wins; otherwise the voicing's drift gives the layer somewhere to go.
        if (l.toSemis !== undefined) {
          const travel = (l.toSemis - (l.semis ?? 0)) * sweepDepth;
          toHz = clampHz(root * ratioFor((l.semis ?? 0) + travel + octave * 12));
        } else if (voicing.drift !== 0) {
          toHz = clampHz(hz * (1 + voicing.drift));
        }
        break;
      }
      case 'sub': {
        wave = voicing.sub;
        hz = root * ratioFor(semis);
        break;
      }
      case 'partial': {
        const ratio = voicing.partials[l.partial ?? 0];
        // A voicing with no partials drops the layer entirely rather than playing it at the
        // fundamental — a doubled fundamental is just a louder sound, which is not what was meant.
        if (ratio === undefined || shimmerScale <= 0) continue;
        wave = voicing.tone;
        hz = root * ratioFor(semis) * ratio;
        gain = l.gain * presence * shimmerScale;
        break;
      }
      case 'noise': {
        if (airScale <= 0) continue;
        wave = 'noise';
        hz = 0;
        gain = l.gain * presence * airScale;
        break;
      }
      case 'click': {
        wave = 'noise';
        hz = 0;
        // The click is contact, not air, so it survives Air being turned off — but it follows the
        // voicing, because a click on Rubber is a duller thing than a click on Glass.
        gain = l.gain * presence * (0.45 + 0.55 * voicing.noiseGain);
        break;
      }
    }

    if (gain < 0.0006) continue;

    const layer: Layer = {
      wave,
      // Rounded, and not only for tidiness: these end up in the URL, which is this tool's save
      // file, and seventeen significant figures of a frequency nobody can hear a hundredth of is
      // forty wasted characters per layer.
      hz: wave === 'noise' ? 0 : Number(clampHz(hz).toFixed(2)),
      ...(toHz !== undefined && Math.abs(toHz - hz) > 0.5 ? { toHz: Number(toHz.toFixed(2)) } : {}),
      gain: Math.min(0.95, Number(gain.toFixed(4))),
      hold: Number(hold.toFixed(4)),
      attack: Number(attack.toFixed(4)),
      ...(l.delay !== undefined ? { delay: Number((l.delay * (0.6 + 0.8 * a.body)).toFixed(4)) } : {}),
      ...(wave === 'noise' && l.role === 'click' ? { highpass: l.highpass ?? 2600 } : {}),
      ...(wave === 'noise' && l.role !== 'click' && l.highpass !== undefined
        ? { highpass: Number(clampHz(l.highpass * lerpExp(a.brightness, 0.6, 1.7)).toFixed(1)) }
        : {}),
      cutoff: Number(cutoff.toFixed(1)),
      ...(l.pan !== undefined ? { pan: l.pan } : {}),
    };
    layers.push(layer);
  }

  const safe = layers.length > 0 ? layers : [{ wave: 'sine' as const, hz: root, gain: 0.1, hold: 0.05 }];

  // The ceiling guard.
  //
  // Gains sum and WebAudio hard-clips above 1.0, so a four-note arpeggio at full Presence with the
  // partials up can add past full scale — and a distorted sound is not a louder sound, it is a
  // different and worse sound that also distorts differently depending on what happens to overlap
  // it. Rather than shortening the sliders' useful travel for every sound because one sound is
  // dense, the generated sound is scaled down as a whole when its own worst instant would exceed
  // the ceiling. So Presence means "as loud as this sound can legally be", and the check on the
  // page stays a real check — it can still fail, but only on layers edited by hand.
  const peak = peakOf(safe);
  if (peak > CEILING) {
    const trim = CEILING / peak;
    return {
      layers: safe.map((layer) => ({ ...layer, gain: Number((layer.gain * trim).toFixed(4)) })),
      bus: sketch.bus,
      minGapMs: sketch.minGapMs,
      ...(sketch.ladder ? { ladder: sketch.ladder } : {}),
    };
  }

  return {
    layers: safe,
    bus: sketch.bus,
    minGapMs: sketch.minGapMs,
    ...(sketch.ladder ? { ladder: sketch.ladder } : {}),
  };
}

/**
 * The loudest instant in a sound: the same sweep the engine's own validator does, because the
 * number this has to stay under is that validator's.
 */
function peakOf(layers: readonly Layer[]): number {
  const edges: { at: number; delta: number }[] = [];
  for (const layer of layers) {
    const start = Math.max(0, layer.delay ?? 0);
    const life = Math.max(0, layer.attack ?? 0.006) + Math.max(0, layer.hold);
    edges.push({ at: start, delta: layer.gain }, { at: start + life, delta: -layer.gain });
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let live = 0;
  let peak = 0;
  for (const edge of edges) {
    live += edge.delta;
    if (live > peak) peak = live;
  }
  return peak;
}

/**
 * A sound taken off the generator and edited by hand.
 *
 * Only the two fields an editor moves. Everything else about the sound — which bus it is on, its
 * ladder, what it is called and what it is for — still comes from the sketch, so a hand-edited
 * `error` is still on the interface bus and still called error, and the saved state is a fraction
 * of the size a whole `SoundDef` would be.
 */
export interface SoundOverride {
  layers: Layer[];
  minGapMs?: number;
}

export function buildKit(spec: KitSpec, overrides: Readonly<Record<string, SoundOverride>> = {}): Record<string, SoundDef> {
  const table: Record<string, SoundDef> = {};
  for (const sketch of SKETCHES) {
    const base = buildSound(sketch, spec);
    const override = overrides[sketch.id];
    table[sketch.id] = override === undefined
      ? base
      : { ...base, layers: override.layers, minGapMs: override.minGapMs ?? base.minGapMs };
  }
  return table;
}
