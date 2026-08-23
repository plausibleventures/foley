/**
 * The gate.
 *
 * `validateSounds` and `validateSong` return problems rather than throwing, on the argument that a
 * shipped app must not refuse to start because a hat is 0.02 too loud. That argument is exactly
 * right at runtime and exactly wrong at build time, so this is where the array is asserted empty —
 * and it is asserted over the *corners of the parameter space* rather than over the defaults,
 * because a table that clips only when three sliders are at their limits is a table that ships and
 * then distorts for the one visitor who moved all three.
 *
 * Every axis is a boolean here: 128 corners per material, five materials, twenty-four sounds. The
 * interior of a hypercube cannot clip if the corners do not, because peak gain is monotonic in
 * every axis this file varies.
 */

import { validateSong, validateSounds } from '@latticekit/audio';
import { AXES, DEFAULT_AXES, SKETCHES, VOICINGS, buildKit, type Axes } from '../src/kit-entry.js';
import { BEDS } from '../src/audio/beds.js';
import { PATTERNS } from '../src/audio/patterns.js';
import { INSTRUMENT_BY_ID } from '../src/audio/instruments.js';

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/* --- the kit, at every corner ------------------------------------------------------------- */

let tables = 0;
for (const voicing of VOICINGS) {
  for (let mask = 0; mask < 1 << AXES.length; mask += 1) {
    const axes: Axes = { ...DEFAULT_AXES };
    AXES.forEach((axis, index) => {
      axes[axis.id] = (mask >> index) & 1 ? 1 : 0;
    });
    for (const key of [-17, 5, 19]) {
      axes.key = key;
      const problems = validateSounds(buildKit({ voicing: voicing.id, axes }));
      tables += 1;
      if (problems.length > 0) {
        const corner = AXES.filter((_, index) => (mask >> index) & 1).map((axis) => axis.id).join('+') || 'all-min';
        failures.push(`${voicing.id} @ key ${String(key)} [${corner}]: ${problems.map((p) => `${p.sound} ${p.code}`).join(', ')}`);
      }
    }
  }
}

/* --- the sounds themselves ----------------------------------------------------------------- */

const ids = new Set<string>();
for (const sketch of SKETCHES) {
  check(!ids.has(sketch.id), `duplicate sound id ${sketch.id}`);
  ids.add(sketch.id);
  check(sketch.layers.length > 0, `${sketch.id} has no layers`);
  check(sketch.minGapMs > 0, `${sketch.id} has no minimum gap`);
  if (sketch.ladder) {
    check(sketch.ladder.steps >= 2, `${sketch.id} ladder is shorter than two steps`);
    check(sketch.ladder.windowMs >= sketch.minGapMs, `${sketch.id} ladder window is shorter than its own gap`);
  }
}
for (const group of ['touch', 'outcome', 'motion', 'state'] as const) {
  const count = SKETCHES.filter((sketch) => sketch.group === group).length;
  check(count === 6, `group ${group} holds ${String(count)} sounds, not the six the grid is laid out for`);
}

/* --- the patterns --------------------------------------------------------------------------- */

for (const pattern of PATTERNS) {
  const problems = validateSong(pattern.song);
  if (problems.length > 0) {
    failures.push(`pattern ${pattern.id}: ${problems.map((p) => `${p.track ?? 'song'} ${p.code} — ${p.message}`).join(' | ')}`);
  }
  for (const track of pattern.song.tracks) {
    check(INSTRUMENT_BY_ID.has(pattern.instruments[track.id] ?? ''), `pattern ${pattern.id} track ${track.id} has no instrument`);
  }
  check(BEDS.some((bed) => bed.id === pattern.bed), `pattern ${pattern.id} names a bed that does not exist: ${pattern.bed}`);
}

/* --- the beds ------------------------------------------------------------------------------- */

for (const bed of BEDS) {
  const sag = bed.options?.sagTo ?? 0.55;
  for (const layer of bed.layers) {
    if (layer.wave === 'noise') continue;
    const lowest = (layer.hz + (layer.beat ?? 0)) * sag;
    check(lowest >= 20, `bed ${bed.id} sags a ${String(layer.hz)} Hz layer to ${lowest.toFixed(1)} Hz, under the audible floor`);
  }
  if (bed.layers.length === 0) continue;
  // A bed that goes silent at some middle value of `tone` is a hole the listener walks into.
  for (let tone = 0; tone <= 1.0001; tone += 0.05) {
    const speaking = bed.layers.some((layer) => {
      const band = layer.band;
      return band === undefined || (tone >= band[0] && tone <= band[1]);
    });
    check(speaking, `bed ${bed.id} is silent at tone ${tone.toFixed(2)} — a hole between its bands`);
  }
}

/* --- the archive ----------------------------------------------------------------------------- */

const { zip } = await import('../src/audio/zip.js');
const archive = zip([{ name: 'a.txt', bytes: new TextEncoder().encode('123456789') }]);
// The check value every CRC-32 implementation is measured against.
const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
check(view.getUint32(14, true) === 0xcbf43926, 'the zip writer computes the wrong CRC-32');
check(view.getUint32(0, true) === 0x04034b50, 'the zip writer does not start with a local file header');

/* --- report ---------------------------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} problem${failures.length === 1 ? '' : 's'}:\n`);
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  if (failures.length > 40) console.error(`  …and ${String(failures.length - 40)} more`);
  (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
}

console.log(
  `ok — ${String(SKETCHES.length)} sounds across ${String(tables)} tables, ` +
    `${String(PATTERNS.length)} patterns, ${String(BEDS.length)} beds.`,
);
