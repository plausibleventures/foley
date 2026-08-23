/**
 * The bench: one sound at a time, and a kit that stays a family while you work on it.
 *
 * Two things are worth knowing before reading this file.
 *
 * **Editing detaches.** Every sound is generated from the material and the axes, so moving a
 * slider rewrites all twenty-four. The moment you touch a layer by hand that sound is copied into
 * `overrides` and stops following them — otherwise the next slider drag would silently throw the
 * edit away, which is the worst thing a tool can do to somebody who has just made a decision.
 *
 * **The waveform is real and the sparklines are not.** The stage is an offline render of the
 * actual buffer; the chips are the summed gain envelope computed arithmetically, because
 * twenty-four offline renders per frame of a slider drag is not a thing anybody's fan should be
 * asked to do to draw a shape four pixels tall.
 */

import { validateSounds, type Layer, type SoundDef, type Wave } from '@latticekit/audio';
import {
  AXES, DEFAULT_AXES, GROUPS, SKETCHES, SKETCH_BY_ID, VOICINGS, VOICING_BY_ID, noteName, rootHzFor,
  type Axes,
} from '../audio/kit.js';
import { renderSound } from '../audio/offline.js';
import { encodeWav, download, normalise as normalisePeak, peakOf, trimTail } from '../audio/wav.js';
import { zip } from '../audio/zip.js';
import { audio as audioEngine, busGain, play, syncKit, unlock } from '../audio/live.js';
import type { SoundOverride } from '../audio/kit.js';
import { kitOf, type State } from '../state.js';
import { track } from '../analytics.js';
import { $, clear, debounce, el, readVar } from './dom.js';
import { dbfs, drawSpark, drawWave, envelopeSeconds } from './draw.js';
import { createLens } from './lens.js';

const WAVES: readonly Wave[] = ['sine', 'triangle', 'square', 'sawtooth', 'noise'];

/** A slider over a value that is not linear in the thing it controls. */
interface Mini extends Scale {
  readonly key: keyof Layer;
  readonly label: string;
  /** Rendered value. */
  readonly format: (value: number) => string;
  /** Absent means the layer may not have it at all, and zero on the slider removes the field. */
  readonly optional?: boolean;
  readonly hideForNoise?: boolean;
}

const MINIS: readonly Mini[] = [
  { key: 'hz', label: 'Pitch', low: 24, high: 12000, log: true, format: (v) => `${v.toFixed(0)} Hz`, hideForNoise: true },
  { key: 'toHz', label: 'Glide to', low: 24, high: 12000, log: true, format: (v) => `${v.toFixed(0)} Hz`, optional: true, hideForNoise: true },
  { key: 'gain', label: 'Gain', low: 0.001, high: 0.7, log: true, format: (v) => v.toFixed(3) },
  { key: 'hold', label: 'Decay', low: 0.004, high: 3, log: true, format: (v) => `${(v * 1000).toFixed(0)} ms` },
  { key: 'attack', label: 'Attack', low: 0.0015, high: 0.6, log: true, format: (v) => `${(v * 1000).toFixed(1)} ms` },
  { key: 'delay', label: 'Delay', low: 0, high: 0.8, format: (v) => `${(v * 1000).toFixed(0)} ms`, optional: true },
  { key: 'cutoff', label: 'Low-pass', low: 120, high: 19000, log: true, format: (v) => `${(v / 1000).toFixed(2)} kHz`, optional: true },
  { key: 'highpass', label: 'High-pass', low: 30, high: 9000, log: true, format: (v) => `${(v / 1000).toFixed(2)} kHz`, optional: true },
  { key: 'pan', label: 'Pan', low: -1, high: 1, format: (v) => (Math.abs(v) < 0.02 ? 'centre' : v < 0 ? `L ${Math.abs(v).toFixed(2)}` : `R ${v.toFixed(2)}`), optional: true },
];

/** Every slider on this page runs 0–1000; a scale says what that means for one control. */
interface Scale {
  readonly low: number;
  readonly high: number;
  /** Exponential, which is the right shape for anything measured in hertz or in seconds. */
  readonly log?: boolean;
}

function toSlider(scale: Scale, value: number): number {
  if (scale.log === true) {
    return Math.round((Math.log(Math.max(scale.low, value) / scale.low) / Math.log(scale.high / scale.low)) * 1000);
  }
  return Math.round(((value - scale.low) / (scale.high - scale.low)) * 1000);
}

function fromSlider(scale: Scale, position: number): number {
  const t = position / 1000;
  return scale.log === true ? scale.low * Math.pow(scale.high / scale.low, t) : scale.low + t * (scale.high - scale.low);
}

/** The sound-level control, which belongs to no layer. */
const GAP: Scale = { low: 10, high: 1500, log: true };

export interface Bench {
  refresh(): void;
  enter(): void;
}

export function mountBench(state: State, changed: () => void): Bench {
  const kitHost = $('#kit');
  const voicingHost = $('#voicings');
  const voicingNote = $('#voicing-note');
  const axesHost = $('#axes');
  const layersHost = $('#layers');
  const checkHost = $('#check');
  const recipeHost = $('#recipe');
  const waveCanvas = $<HTMLCanvasElement>('#wave');
  const waveReadout = $('#wave-readout');
  const stageName = $('#stage-name');
  const stageTag = $('#stage-tag');
  const status = $('#bench-status');
  const keyInput = $<HTMLInputElement>('#key');
  const keyValue = $('#key-value');
  const kitName = $<HTMLInputElement>('#kitname');
  const normaliseInput = $<HTMLInputElement>('#normalise');

  const sparks = new Map<string, HTMLCanvasElement>();
  let recipeMode: 'one' | 'all' = 'one';

  const bench = state.bench;

  /* ------------------------------------------------------------------------------------------
     Deriving
     ------------------------------------------------------------------------------------------ */

  const table = (): Record<string, SoundDef> => kitOf(bench);
  // Through `buildKit` rather than reaching into `overrides`, so an edited sound keeps the bus,
  // the ladder and the gap that its sketch gave it — the editor only ever owns the layers.
  const current = (): SoundDef => table()[bench.selected]!;

  /** Copy the generated sound into `overrides`, which is what detaches it from the axes. */
  function detach(): SoundOverride {
    const existing = bench.overrides[bench.selected];
    if (existing !== undefined) return existing;
    const copy: SoundOverride = { layers: current().layers.map((layer) => ({ ...layer })) };
    bench.overrides[bench.selected] = copy;
    return copy;
  }

  /* ------------------------------------------------------------------------------------------
     The stage
     ------------------------------------------------------------------------------------------ */

  let lastBuffer: AudioBuffer | null = null;
  let renderToken = 0;

  const renderWave = debounce(90, () => {
    const token = ++renderToken;
    const sound = current();
    void renderSound(sound).then((buffer) => {
      if (token !== renderToken) return;
      const peak = peakOf(buffer);
      // What is drawn is what is downloaded: the trimmed buffer, so the picture is not four
      // fifths silence and the ruler is the length of the file rather than of the render.
      const trimmed = trimTail(buffer);
      lastBuffer = trimmed;
      drawWave(waveCanvas, trimmed);
      clear(waveReadout);
      for (const [label, value] of [
        ['peak', dbfs(peak)],
        ['length', `${(trimmed.duration * 1000).toFixed(0)} ms`],
        ['layers', String(sound.layers.length)],
        ['gap', `${String(sound.minGapMs)} ms`],
      ] as const) {
        waveReadout.append(el('span', {}, [label, el('b', { text: value })]));
      }
    });
  });

  const hint = $('#wave-hint');

  function refreshStage(): void {
    const sketch = SKETCH_BY_ID.get(bench.selected)!;
    stageName.textContent = sketch.label;
    stageTag.textContent = sketch.note;
    // A bus muted over on the floor is the one way a sound on this page can be silent with nothing
    // on screen to explain it. Say so, in the place somebody is already looking.
    const through = busGain(sketch.bus);
    if (through <= 0.001) {
      hint.textContent = `the ${sketch.bus} bus is silenced in the mixer — this will not be audible`;
      hint.style.color = 'var(--spot)';
    } else {
      hint.textContent = 'press the waveform to hear it';
      hint.style.color = '';
    }
    renderWave();
  }

  /* ------------------------------------------------------------------------------------------
     The kit grid
     ------------------------------------------------------------------------------------------ */

  function buildKitGrid(): void {
    clear(kitHost);
    sparks.clear();
    for (const group of GROUPS) {
      const section = el('div', { class: 'family' });
      section.append(
        el('div', { class: 'family__head' }, [
          el('span', { class: 'family__name', text: group.label }),
          el('span', { class: 'family__note', text: group.note }),
        ]),
      );
      const grid = el('div', { class: 'sounds' });
      for (const sketch of SKETCHES.filter((s) => s.group === group.id)) {
        const spark = el('canvas', { class: 'sound__spark', 'aria-hidden': 'true' });
        sparks.set(sketch.id, spark);
        const name = el('span', { class: 'sound__name' }, [sketch.label]);
        const button = el('button', { class: 'sound', type: 'button', title: sketch.note }, [name, spark]);
        button.dataset['id'] = sketch.id;
        button.addEventListener('click', () => {
          bench.selected = sketch.id;
          play(sketch.id);
          refreshSelection();
          refreshStage();
          refreshLayers();
          refreshRecipe();
          changed();
        });
        grid.append(button);
      }
      section.append(grid);
      kitHost.append(section);
    }
  }

  function refreshSelection(): void {
    for (const button of kitHost.querySelectorAll<HTMLButtonElement>('.sound')) {
      button.setAttribute('aria-current', button.dataset['id'] === bench.selected ? 'true' : 'false');
    }
  }

  function refreshSparks(): void {
    const built = table();
    const spot = readVar('--spot');
    const ink = readVar('--muted');
    for (const [id, canvas] of sparks) {
      const sound = built[id];
      if (sound === undefined) continue;
      const name = canvas.parentElement?.querySelector('.sound__name');
      if (name) {
        const dot = name.querySelector('.sound__edited');
        if (id in bench.overrides && dot === null) name.append(el('span', { class: 'sound__edited', title: 'edited by hand' }));
        else if (!(id in bench.overrides) && dot) dot.remove();
      }
      drawSpark(canvas, sound, envelopeSeconds(sound) * 1.04, id === bench.selected ? spot : ink);
    }
  }

  /* ------------------------------------------------------------------------------------------
     Materials and axes
     ------------------------------------------------------------------------------------------ */

  function buildVoicings(): void {
    clear(voicingHost);
    for (const voicing of VOICINGS) {
      const button = el('button', { class: 'pick', type: 'button' }, [
        el('span', { class: 'pick__name', text: voicing.name }),
        el('span', { class: 'pick__tag', text: voicing.tag }),
      ]);
      button.dataset['id'] = voicing.id;
      button.addEventListener('click', () => {
        bench.voicing = voicing.id;
        track('material_change', { to: voicing.id });
        refreshVoicings();
        apply();
        play(bench.selected);
      });
      voicingHost.append(button);
    }
  }

  function refreshVoicings(): void {
    for (const button of voicingHost.querySelectorAll<HTMLButtonElement>('.pick')) {
      button.setAttribute('aria-pressed', button.dataset['id'] === bench.voicing ? 'true' : 'false');
    }
    voicingNote.textContent = (VOICING_BY_ID.get(bench.voicing) ?? VOICINGS[0]!).blurb;
  }

  function buildAxes(): void {
    clear(axesHost);
    const lens = createLens('Every one of these moves all twenty-four sounds at once. Point at one to read what it actually changes.');
    axesHost.append(lens.node);
    for (const axis of AXES) {
      const value = el('span', { class: 'axis__value' });
      const input = el('input', { type: 'range', min: '0', max: '1000', step: '1' }) as HTMLInputElement;
      input.dataset['axis'] = axis.id;
      const write = (): void => {
        value.textContent = `${String(Math.round((bench.axes[axis.id] as number) * 100))}%`;
      };
      input.addEventListener('input', () => {
        (bench.axes[axis.id] as number) = Number(input.value) / 1000;
        write();
        apply();
      });
      input.addEventListener('change', () => { play(bench.selected); });
      const row = el('div', { class: 'axis' }, [
        el('div', { class: 'axis__head' }, [el('span', { class: 'axis__label', text: axis.label }), value]),
        input,
        el('div', { class: 'axis__ends' }, [el('span', { text: axis.ends[0] }), el('span', { text: axis.ends[1] })]),
      ]);
      lens.watch(row, axis.label, axis.note);
      axesHost.append(row);
    }
    refreshAxes();
  }

  function refreshAxes(): void {
    for (const input of axesHost.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      const key = input.dataset['axis'] as keyof Axes;
      input.value = String(Math.round((bench.axes[key] as number) * 1000));
      const value = input.parentElement?.querySelector('.axis__value');
      if (value) value.textContent = `${String(Math.round((bench.axes[key] as number) * 100))}%`;
    }
    keyInput.value = String(bench.axes.key);
    keyValue.textContent = `${noteName(bench.axes.key)} · ${rootHzFor(bench.axes.key).toFixed(1)} Hz`;
  }

  keyInput.addEventListener('input', () => {
    bench.axes.key = Number(keyInput.value);
    keyValue.textContent = `${noteName(bench.axes.key)} · ${rootHzFor(bench.axes.key).toFixed(1)} Hz`;
    apply();
  });
  keyInput.addEventListener('change', () => { play(bench.selected); });

  /* ------------------------------------------------------------------------------------------
     The layer editor
     ------------------------------------------------------------------------------------------ */

  /** The one bit of the panel that has to stay right while a slider is being dragged. */
  function refreshLayerStatus(): void {
    const detached = bench.selected in bench.overrides;
    $('#layers-hint').textContent = detached
      ? 'edited by hand — no longer following the axes'
      : `${String(current().layers.length)} in ${SKETCH_BY_ID.get(bench.selected)!.label}, from the material`;
    ($('#layer-revert') as HTMLButtonElement).disabled = !detached;
  }

  function refreshLayers(): void {
    clear(layersHost);
    const sound = current();
    $('#layers-title').textContent = 'Layers';
    refreshLayerStatus();

    // The gap belongs to the sound rather than to any layer, and it is the control most likely to
    // be wrong in somebody else's kit: it is what turns twenty plays in one frame into one sound.
    {
      const value = el('span', { class: 'mini__value', text: `${String(sound.minGapMs)} ms` });
      const input = el('input', { type: 'range', min: '0', max: '1000', step: '1' }) as HTMLInputElement;
      input.value = String(toSlider(GAP, sound.minGapMs));
      input.addEventListener('input', () => {
        const next = Math.round(fromSlider(GAP, Number(input.value)));
        value.textContent = `${String(next)} ms`;
        detach().minGapMs = next;
        apply();
      });
      layersHost.append(
        el('div', { class: 'mini', style: 'padding-bottom:0.5rem' }, [
          el('span', { class: 'mini__label', text: 'Minimum gap', title: 'The shortest time between two plays of this sound. Anything faster is dropped rather than queued.' }),
          input,
          value,
        ]),
      );
    }

    sound.layers.forEach((layer, index) => {
      const card = el('div', { class: 'layer' });
      const waves = el('div', { class: 'layer__wave' });
      for (const wave of WAVES) {
        const short = { sine: 'sine', triangle: 'tri', square: 'sqr', sawtooth: 'saw', noise: 'noise' }[wave];
        const button = el('button', { type: 'button', text: short, title: wave }) as HTMLButtonElement;
        button.setAttribute('aria-pressed', layer.wave === wave ? 'true' : 'false');
        button.addEventListener('click', () => {
          const target = detach();
          target.layers = target.layers.map((l, i) => (i === index ? { ...l, wave } : { ...l }));
          apply();
          refreshLayers();
          play(bench.selected);
        });
        waves.append(button);
      }
      const remove = el('button', { class: 'icon', type: 'button', text: '×', title: 'remove this layer', 'aria-label': 'Remove layer' }) as HTMLButtonElement;
      remove.disabled = sound.layers.length < 2;
      remove.addEventListener('click', () => {
        const target = detach();
        target.layers = target.layers.filter((_, i) => i !== index).map((l) => ({ ...l }));
        apply();
        refreshLayers();
      });
      card.append(el('div', { class: 'layer__head' }, [el('span', { class: 'layer__n', text: `L${String(index + 1)}` }), waves, remove]));

      const body = el('div', { class: 'layer__body' });
      for (const mini of MINIS) {
        if (mini.hideForNoise === true && layer.wave === 'noise') continue;
        const raw = layer[mini.key] as number | undefined;
        const present = raw !== undefined;
        const shown = present ? raw : mini.key === 'toHz' ? layer.hz : mini.low;
        const value = el('span', { class: 'mini__value', text: present ? mini.format(shown) : 'off' });
        const input = el('input', { type: 'range', min: '0', max: '1000', step: '1' }) as HTMLInputElement;
        input.value = String(toSlider(mini, shown));
        if (!present) input.classList.add('mini--off');

        const write = (next: number | undefined): void => {
          const target = detach();
          const layers = target.layers.map((l) => ({ ...l }));
          const patched = { ...layers[index]! } as Record<string, unknown>;
          if (next === undefined) delete patched[mini.key];
          else patched[mini.key] = Number(next.toFixed(mini.key === 'gain' || mini.key === 'pan' ? 4 : 5));
          layers[index] = patched as unknown as Layer;
          target.layers = layers;
          apply();
        };

        input.addEventListener('input', () => {
          const next = fromSlider(mini, Number(input.value));
          value.textContent = mini.format(next);
          write(next);
        });
        input.addEventListener('change', () => { play(bench.selected); });

        const label = el('span', { class: `mini__label${mini.optional === true ? ' mini__label--optional' : ''}`, text: mini.label });
        if (mini.optional === true) {
          label.title = present ? 'click to take this stage out of the chain' : 'click to put this stage in the chain';
          label.addEventListener('click', () => {
            write(present ? undefined : fromSlider(mini, Number(input.value)));
            refreshLayers();
          });
        }
        body.append(el('div', { class: 'mini' }, [label, input, value]));
      }
      card.append(body);
      layersHost.append(card);
    });
  }

  ($('#layer-add') as HTMLButtonElement).addEventListener('click', () => {
    const target = detach();
    const root = rootHzFor(bench.axes.key);
    target.layers = [
      ...target.layers.map((l) => ({ ...l })),
      { wave: 'sine', hz: root, gain: 0.08, hold: 0.08, cutoff: 4000 },
    ];
    apply();
    refreshLayers();
    play(bench.selected);
  });

  ($('#layer-revert') as HTMLButtonElement).addEventListener('click', () => {
    delete bench.overrides[bench.selected];
    apply();
    refreshLayers();
    play(bench.selected);
  });

  /* ------------------------------------------------------------------------------------------
     The check, and the recipe
     ------------------------------------------------------------------------------------------ */

  function refreshCheck(): void {
    const problems = validateSounds(table());
    clear(checkHost);
    if (problems.length === 0) {
      checkHost.className = 'check check--ok';
      checkHost.append(
        el('span', { text: `All ${String(SKETCHES.length)} sounds pass. Nothing clips, nothing is inaudible, every sound has a minimum gap, and no ladder is shorter than the gap it ladders over.` }),
      );
      return;
    }
    checkHost.className = 'check check--bad';
    checkHost.append(el('span', { text: `${String(problems.length)} problem${problems.length === 1 ? '' : 's'} in this table:` }));
    const list = el('ul');
    for (const problem of problems.slice(0, 8)) {
      list.append(el('li', {}, [el('code', { text: problem.code }), ' — ', problem.message]));
    }
    checkHost.append(list);
  }

  function fixed(value: number): string {
    return String(Number(value.toFixed(5)));
  }

  function layerSource(layer: Layer): string {
    const parts = [`wave: '${layer.wave}'`, `hz: ${fixed(layer.hz)}`];
    if (layer.toHz !== undefined) parts.push(`toHz: ${fixed(layer.toHz)}`);
    parts.push(`gain: ${fixed(layer.gain)}`, `hold: ${fixed(layer.hold)}`);
    if (layer.attack !== undefined) parts.push(`attack: ${fixed(layer.attack)}`);
    if (layer.delay !== undefined) parts.push(`delay: ${fixed(layer.delay)}`);
    if (layer.cutoff !== undefined) parts.push(`cutoff: ${fixed(layer.cutoff)}`);
    if (layer.highpass !== undefined) parts.push(`highpass: ${fixed(layer.highpass)}`);
    if (layer.pan !== undefined) parts.push(`pan: ${fixed(layer.pan)}`);
    return `{ ${parts.join(', ')} }`;
  }

  function soundSource(id: string, sound: SoundDef, indent: string): string {
    const head = `${indent}${/^[a-z][a-z0-9]*$/i.test(id) ? id : `'${id}'`}: {`;
    const meta = [`bus: '${sound.bus ?? 'sfx'}'`, `minGapMs: ${String(sound.minGapMs)}`];
    if (sound.ladder) meta.push(`ladder: { steps: ${String(sound.ladder.steps)}, windowMs: ${String(sound.ladder.windowMs)} }`);
    const layers = sound.layers.map((layer) => `${indent}    ${layerSource(layer)},`).join('\n');
    return `${head}\n${indent}  ${meta.join(', ')},\n${indent}  layers: [\n${layers}\n${indent}  ],\n${indent}},`;
  }

  function refreshRecipe(): void {
    const built = table();
    let body: string;
    if (recipeMode === 'one') {
      body = soundSource(bench.selected, built[bench.selected]!, '  ');
    } else {
      body = SKETCHES.map((sketch) => soundSource(sketch.id, built[sketch.id]!, '  ')).join('\n');
    }
    const voicing = VOICING_BY_ID.get(bench.voicing)!;
    recipeHost.textContent =
      `// ${bench.kitName || 'foley'} — ${voicing.name}, ${noteName(bench.axes.key)}\n` +
      `import { createAudio } from '@latticekit/audio';\n\n` +
      `export const SOUNDS = {\n${body}\n} as const;\n\n` +
      `export const audio = createAudio({ sounds: SOUNDS });\n` +
      `// then, from a real interaction handler: audio.unlock(); audio.play('${bench.selected}');`;
  }

  for (const [id, mode] of [['#recipe-one', 'one'], ['#recipe-all', 'all']] as const) {
    $(id).addEventListener('click', () => {
      recipeMode = mode;
      $('#recipe-one').setAttribute('aria-pressed', String(mode === 'one'));
      $('#recipe-all').setAttribute('aria-pressed', String(mode === 'all'));
      refreshRecipe();
    });
  }

  $('#recipe-copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(recipeHost.textContent ?? '').then(
      () => { track('copy_recipe', { scope: recipeMode }); say('Recipe copied.'); },
      () => { say('The browser refused the clipboard.'); },
    );
  });

  /* ------------------------------------------------------------------------------------------
     Export
     ------------------------------------------------------------------------------------------ */

  let busy = false;

  function say(message: string, working = false): void {
    status.textContent = message;
    status.className = working ? 'status status--busy' : 'status';
  }

  async function wavFor(sound: SoundDef): Promise<Uint8Array> {
    const buffer = trimTail(await renderSound(sound));
    return encodeWav(bench.normalise ? normalisePeak(buffer, 0.891) : buffer);
  }

  ($('#dl-one') as HTMLButtonElement).addEventListener('click', () => {
    if (busy) return;
    busy = true;
    say('Rendering…', true);
    void wavFor(current()).then((bytes) => {
      download(`${bench.kitName || 'foley'}-${bench.selected}.wav`, bytes, 'audio/wav');
      track('download_sound', { sound: bench.selected, material: bench.voicing, key: noteName(bench.axes.key), edited: bench.selected in bench.overrides });
      say(`${bench.selected}.wav — ${(bytes.length / 1024).toFixed(1)} kB.`);
      busy = false;
    });
  });

  ($('#dl-kit') as HTMLButtonElement).addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const built = table();
    const name = bench.kitName || 'foley';
    void (async () => {
      const entries: { name: string; bytes: Uint8Array }[] = [];
      for (const sketch of SKETCHES) {
        say(`Rendering ${sketch.label}… (${String(entries.length + 1)} of ${String(SKETCHES.length)})`, true);
        entries.push({ name: `${name}/${sketch.label}.wav`, bytes: await wavFor(built[sketch.id]!) });
      }
      entries.push({
        name: `${name}/${name}.ts`,
        bytes: new TextEncoder().encode(
          `// ${name} — ${VOICING_BY_ID.get(bench.voicing)!.name}, ${noteName(bench.axes.key)}\n` +
            `// Made with Foley — https://foley.plausible.ventures\n` +
            `import { createAudio } from '@latticekit/audio';\n\nexport const SOUNDS = {\n` +
            SKETCHES.map((sketch) => soundSource(sketch.id, built[sketch.id]!, '  ')).join('\n') +
            `\n} as const;\n\nexport const audio = createAudio({ sounds: SOUNDS });\n`,
        ),
      });
      const bytes = zip(entries);
      download(`${name}.zip`, bytes, 'application/zip');
      track('download_kit', { material: bench.voicing, key: noteName(bench.axes.key), sounds: SKETCHES.length, edited: Object.keys(bench.overrides).length });
      say(`${name}.zip — ${String(SKETCHES.length)} sounds, ${(bytes.length / 1024).toFixed(0)} kB.`);
      busy = false;
    })();
  });

  $('#share').addEventListener('click', () => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => { track('copy_link', { room: 'bench' }); say('Link copied — it carries the whole kit.'); },
      () => { say('The browser refused the clipboard.'); },
    );
  });

  kitName.addEventListener('input', () => {
    bench.kitName = kitName.value.trim().replaceAll(/[^\w-]+/g, '-').slice(0, 40);
    refreshRecipe();
    changed();
  });
  normaliseInput.addEventListener('change', () => {
    bench.normalise = normaliseInput.checked;
    renderWave();
  });

  $('#surprise').addEventListener('click', () => {
    bench.voicing = VOICINGS[Math.floor(Math.random() * VOICINGS.length)]!.id;
    bench.axes.key = Math.round(-8 + Math.random() * 20);
    for (const axis of AXES) {
      // Pulled toward the middle rather than uniform: the ends of these ranges are useful on
      // purpose and awful in combination, and a randomiser that mostly produces awful is a
      // randomiser nobody presses twice.
      bench.axes[axis.id] = Math.min(1, Math.max(0, (Math.random() + Math.random() + Math.random()) / 3));
    }
    refreshVoicings();
    apply();
    play(bench.selected);
  });

  $('#reset').addEventListener('click', () => {
    bench.axes = { ...bench.axes, ...DEFAULT_AXES, key: bench.axes.key };
    apply();
  });

  /*
   * The tour.
   *
   * Twenty-four chips is a lot to click through before anybody believes the claim that they are
   * one family, and the claim is the product. Six and a half seconds of the kit in order — touch,
   * state, motion, outcome — is the fastest way to hear the thing that is actually being sold,
   * which is that two of these landing together make a chord.
   *
   * Scheduled against the audio clock rather than by timer: `PlayOptions.at` is the same clock the
   * engine schedules on, so the phrase keeps its rhythm through a busy frame. The highlight is on
   * a timer, because the DOM has no other clock.
   */
  const TOUR: readonly (readonly [string, number])[] = [
    ['tap', 0], ['hover', 0.18], ['select', 0.34], ['press', 0.62], ['release', 0.75],
    ['toggle-on', 1.02], ['toggle-off', 1.28], ['unlock', 1.6], ['lock', 1.95],
    ['open', 2.35], ['close', 2.66], ['send', 2.95], ['receive', 3.3],
    ['type', 3.75], ['capture', 3.95], ['swipe', 4.2], ['delete', 4.45],
    ['confirm', 4.85], ['error', 5.25], ['deny', 5.6], ['warn', 5.9],
    ['arrive', 6.35], ['complete', 7.0], ['success', 7.9],
  ];

  let touring = false;

  ($('#tour') as HTMLButtonElement).addEventListener('click', () => {
    const button = $('#tour') as HTMLButtonElement;
    if (touring) return;
    if (!unlock()) return;
    touring = true;
    track('tour_played');
    button.disabled = true;
    // Put the selection back afterwards: the tour borrows it to walk the grid, and a visitor who
    // had a sound open should find it open again.
    const wasSelected = bench.selected;
    const start = audioEngine().now() + 0.06;
    for (const [id, offset] of TOUR) {
      audioEngine().play(id, { at: start + offset });
      window.setTimeout(() => {
        bench.selected = id;
        refreshSelection();
        refreshSparks();
      }, offset * 1000 + 60);
    }
    window.setTimeout(() => {
      touring = false;
      button.disabled = false;
      bench.selected = wasSelected;
      refreshSelection();
      refreshSparks();
      refreshStage();
      refreshLayers();
      refreshRecipe();
      changed();
    }, 8900);
  });

  waveCanvas.addEventListener('click', () => { play(bench.selected); });
  waveCanvas.style.cursor = 'pointer';

  /* ------------------------------------------------------------------------------------------
     The one function everything calls
     ------------------------------------------------------------------------------------------ */

  function apply(): void {
    syncKit(table());
    refreshLayerStatus();
    refreshSparks();
    refreshCheck();
    refreshRecipe();
    refreshStage();
    refreshAxes();
    changed();
  }

  buildKitGrid();
  buildVoicings();
  buildAxes();
  kitName.value = bench.kitName;
  normaliseInput.checked = bench.normalise;

  window.addEventListener('resize', debounce(140, () => {
    refreshSparks();
    drawWave(waveCanvas, lastBuffer);
  }));

  return {
    refresh() {
      refreshVoicings();
      refreshSelection();
      refreshLayers();
      kitName.value = bench.kitName;
      normaliseInput.checked = bench.normalise;
      apply();
    },
    enter() {
      // The canvas had no width while its panel was hidden, and the mixer may have moved on the
      // floor since this was last on screen.
      drawWave(waveCanvas, lastBuffer);
      refreshSparks();
      refreshStage();
    },
  };
}
