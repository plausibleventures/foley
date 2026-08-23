/**
 * Two drawings, and neither of them is an analyser.
 *
 * The big one is the *actual samples*: the sound is rendered offline, faster than real time, and
 * what you see is the buffer that will be written into the file, not a picture of the recipe. The
 * small one — the sparkline on every chip in the kit — is the opposite, and deliberately so: it
 * is the summed gain envelope worked out arithmetically from the layers, because redrawing
 * twenty-four offline renders on every frame of a slider drag is a hundred milliseconds of work to
 * change a shape that is four pixels tall.
 */

import type { SoundDef } from '@latticekit/audio';
import { fitCanvas, readVar } from './dom.js';

/* --------------------------------------------------------------------------------------------
   The stage waveform
   -------------------------------------------------------------------------------------------- */

/** Tick spacings in milliseconds, coarsest last. The first one that gives under twelve ticks wins. */
const TICKS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000];

export function drawWave(canvas: HTMLCanvasElement, buffer: AudioBuffer | null): void {
  const context = fitCanvas(canvas);
  if (context === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);

  const spot = readVar('--spot');
  const rule = readVar('--rule');
  const muted = readVar('--muted');

  const padTop = 14;
  const padBottom = 22;
  const mid = padTop + (height - padTop - padBottom) / 2;
  const half = (height - padTop - padBottom) / 2;

  // The centre line, always, so an empty stage still reads as a stage.
  context.strokeStyle = rule;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, Math.round(mid) + 0.5);
  context.lineTo(width, Math.round(mid) + 0.5);
  context.stroke();

  if (buffer === null) return;

  const seconds = buffer.duration;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  let peak = 0;
  for (let i = 0; i < left.length; i += 1) {
    const magnitude = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
    if (magnitude > peak) peak = magnitude;
  }
  // Drawn to fit rather than to full scale: an interface sound peaks around a fifth of full
  // scale, and at true scale every shape on this page would be a flat line. The number under the
  // stage says what the level actually is.
  const scale = peak > 0.0001 ? half / peak : half;

  const step = Math.max(1, Math.floor(left.length / Math.max(1, Math.round(width))));

  // Time ruler.
  const totalMs = seconds * 1000;
  const spacing = TICKS_MS.find((ms) => totalMs / ms <= 12) ?? 2000;
  context.fillStyle = muted;
  context.font = '10px ui-monospace, monospace';
  context.textAlign = 'left';
  for (let ms = 0; ms <= totalMs; ms += spacing) {
    const x = Math.round((ms / totalMs) * width) + 0.5;
    context.strokeStyle = rule;
    context.globalAlpha = ms === 0 ? 0 : 0.55;
    context.beginPath();
    context.moveTo(x, padTop - 6);
    context.lineTo(x, height - padBottom + 6);
    context.stroke();
    context.globalAlpha = 1;
    if (ms > 0 && ms < totalMs - spacing * 0.4) {
      context.fillText(`${String(Math.round(ms))} ms`, x + 4, height - 7);
    }
  }

  // The samples, as a filled min/max envelope.
  context.fillStyle = spot;
  context.globalAlpha = 0.9;
  context.beginPath();
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor((x / width) * left.length);
    const end = Math.min(left.length, start + step);
    let low = 0;
    let high = 0;
    for (let i = start; i < end; i += 1) {
      const sample = (left[i]! + right[i]!) / 2;
      if (sample < low) low = sample;
      if (sample > high) high = sample;
    }
    tops.push(mid - high * scale);
    bottoms.push(mid - low * scale);
  }
  context.moveTo(0, tops[0] ?? mid);
  for (let x = 0; x < tops.length; x += 1) context.lineTo(x, tops[x]!);
  for (let x = bottoms.length - 1; x >= 0; x -= 1) context.lineTo(x, bottoms[x]!);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
}

/* --------------------------------------------------------------------------------------------
   The chip sparkline
   -------------------------------------------------------------------------------------------- */

const ATTACK_SEC = 0.006;

/** The summed gain envelope at `t`, which is what a sound's silhouette actually is. */
function envelopeAt(sound: SoundDef, t: number): number {
  let total = 0;
  for (const layer of sound.layers) {
    const start = layer.delay ?? 0;
    const attack = layer.attack ?? ATTACK_SEC;
    const end = start + attack + layer.hold;
    if (t < start || t > end) continue;
    if (t < start + attack) total += layer.gain * ((t - start) / attack);
    // The decay is an exponential landing on −80 dB, which is what the renderer actually schedules.
    else total += layer.gain * Math.pow(0.0001 / 1, (t - start - attack) / Math.max(0.0001, layer.hold));
  }
  return total;
}

/** Where the last layer stops sounding — the sparkline's width, and not a moment more. */
export function envelopeSeconds(sound: SoundDef): number {
  let end = 0.02;
  for (const layer of sound.layers) {
    const life = (layer.delay ?? 0) + (layer.attack ?? ATTACK_SEC) + layer.hold;
    if (life > end) end = life;
  }
  return end;
}

export function drawSpark(canvas: HTMLCanvasElement, sound: SoundDef, seconds: number, colour: string): void {
  const context = fitCanvas(canvas);
  if (context === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  if (width < 2) return;

  const mid = height / 2;
  let peak = 0.0001;
  const values: number[] = [];
  for (let x = 0; x < width; x += 1) {
    const value = envelopeAt(sound, (x / width) * seconds);
    values.push(value);
    if (value > peak) peak = value;
  }
  const scale = (height / 2 - 1) / peak;

  context.fillStyle = colour;
  context.globalAlpha = 0.75;
  context.beginPath();
  context.moveTo(0, mid);
  for (let x = 0; x < width; x += 1) context.lineTo(x, mid - values[x]! * scale);
  for (let x = width - 1; x >= 0; x -= 1) context.lineTo(x, mid + values[x]! * scale);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
}

export function dbfs(peak: number): string {
  if (peak <= 0.00001) return '−∞ dBFS';
  return `${(20 * Math.log10(peak)).toFixed(1)} dBFS`.replace('-', '−');
}
