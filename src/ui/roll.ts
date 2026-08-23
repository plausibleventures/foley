/**
 * The roll: every voice the engine decides to build, drawn as it is decided.
 *
 * There is no `AnalyserNode` anywhere in this project, and that is not a limitation being worked
 * around — it is the better instrument for this job. An analyser reports what a device is
 * *emitting*, one frame late, and only when a device exists. `onScheduled` reports what the engine
 * *decided*, at the moment it decides it, with the exact times, pitches and gains it decided on,
 * and it reports them identically in a test with no sound card. So the roll is not an
 * approximation of what you hear; it is the thing you hear, drawn.
 *
 * The most useful consequence is visible at the right-hand edge. The sequencer schedules a second
 * and a half ahead of the clock — that is what keeps it from stuttering when the tab is hidden,
 * because a hidden tab throttles timers to about a second — so notes appear on the far side of the
 * now-line and then travel to it. You are watching the lookahead.
 */

import type { VoicePlan } from '@latticekit/audio';
import { audio, watchVoices } from '../audio/live.js';
import { fitCanvas, readVar } from './dom.js';

interface Mark {
  bus: string;
  wave: string;
  hz: number;
  toHz: number;
  gain: number;
  start: number;
  end: number;
}

const WINDOW_SEC = 6;
const NOW_AT = 0.74;
const LOW_HZ = 38;
const HIGH_HZ = 13000;

export interface Roll {
  stop(): void;
}

export function startRoll(canvas: HTMLCanvasElement, readout: HTMLElement): Roll {
  const marks: Mark[] = [];
  let scheduled = 0;

  const unwatch = watchVoices((plan: Readonly<VoicePlan>) => {
    // The bed emits a plan whenever its targets move. Those are states, not notes: drawing a
    // one-second block every time a slider twitches would say something untrue about the music.
    if (plan.source === 'bed') return;
    scheduled += 1;
    // The plan object is reused between calls, so anything kept has to be a copy.
    marks.push({
      bus: plan.bus,
      wave: plan.wave,
      hz: plan.hz,
      toHz: plan.toHz,
      gain: plan.gain,
      start: plan.start,
      end: plan.end,
    });
    if (marks.length > 900) marks.splice(0, marks.length - 900);
  });

  let frame = 0;

  const y = (hz: number, top: number, bottom: number): number => {
    const clamped = Math.min(HIGH_HZ, Math.max(LOW_HZ, hz));
    const fraction = Math.log(clamped / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ);
    return bottom - fraction * (bottom - top);
  };

  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    const context = fitCanvas(canvas);
    if (context === null) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);

    const rule = readVar('--rule');
    const ruleSoft = readVar('--rule-soft');
    const muted = readVar('--muted');
    const colours: Record<string, string> = {
      ui: readVar('--bus-ui'),
      sfx: readVar('--bus-sfx'),
      music: readVar('--bus-music'),
      master: readVar('--muted'),
    };

    const top = 28;
    const bottom = height - 30;
    const noiseLane = top - 12;
    const now = audio().now();
    const from = now - WINDOW_SEC * NOW_AT;
    const to = now + WINDOW_SEC * (1 - NOW_AT);
    const x = (t: number): number => ((t - from) / (to - from)) * width;

    // Frequency gridlines. Decades, because the axis is logarithmic and a listener's ear is too.
    context.font = '10px ui-monospace, monospace';
    context.textAlign = 'right';
    for (const hz of [100, 1000, 10000]) {
      const line = Math.round(y(hz, top, bottom)) + 0.5;
      context.strokeStyle = ruleSoft;
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(width, line);
      context.stroke();
      context.fillStyle = muted;
      context.fillText(hz >= 1000 ? `${String(hz / 1000)}k` : String(hz), width - 6, line - 3);
    }

    // The lookahead region, and the now-line.
    const nowX = Math.round(x(now)) + 0.5;
    context.fillStyle = rule;
    context.globalAlpha = 0.18;
    context.fillRect(nowX, 0, width - nowX, height);
    context.globalAlpha = 1;
    context.strokeStyle = readVar('--ink');
    context.beginPath();
    context.moveTo(nowX, 0);
    context.lineTo(nowX, height);
    context.stroke();
    context.fillStyle = muted;
    context.textAlign = 'left';
    if (width - nowX > 112) context.fillText('scheduled ahead', nowX + 6, height - 8);

    // Prune anything that has scrolled off the left.
    while (marks.length > 0 && marks[0]!.end < from) marks.shift();

    let live = 0;
    for (const mark of marks) {
      if (mark.end < from || mark.start > to) continue;
      if (mark.start <= now && mark.end > now) live += 1;
      const colour = colours[mark.bus] ?? muted;
      const x0 = x(mark.start);
      const x1 = Math.max(x0 + 1.5, x(mark.end));
      const alpha = Math.min(0.95, 0.2 + mark.gain * 3.4);
      context.globalAlpha = mark.start > now ? alpha * 0.45 : alpha;

      if (mark.wave === 'noise') {
        // Noise has no pitch to plot, so it gets its own lane above the axis rather than a
        // fictional position on it.
        context.fillStyle = colour;
        context.fillRect(x0, noiseLane - 3, x1 - x0, 6);
      } else {
        const y0 = y(mark.hz, top, bottom);
        const y1 = y(mark.toHz, top, bottom);
        const thickness = 1.5 + Math.min(7, mark.gain * 22);
        context.fillStyle = colour;
        context.beginPath();
        context.moveTo(x0, y0 - thickness / 2);
        context.lineTo(x1, y1 - thickness / 2);
        context.lineTo(x1, y1 + thickness / 2);
        context.lineTo(x0, y0 + thickness / 2);
        context.closePath();
        context.fill();
      }
      context.globalAlpha = 1;
    }

    context.fillStyle = muted;
    context.textAlign = 'left';
    context.fillText('noise', 6, noiseLane + 4);

    readout.textContent = '';
    const engine = audio();
    for (const [label, value] of [
      ['sounding', String(live)],
      ['one-shots', `${String(engine.voices)} / ${String(engine.maxVoices)}`],
      ['scheduled', String(scheduled)],
    ] as const) {
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = value;
      span.append(document.createTextNode(label), b);
      readout.append(span);
    }
  };

  frame = requestAnimationFrame(draw);

  return {
    stop() {
      cancelAnimationFrame(frame);
      unwatch();
    },
  };
}
