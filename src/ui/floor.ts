/**
 * The floor: a sequencer, a bed and twenty-four pads, running at once.
 *
 * The one structural decision worth explaining is that there is exactly **one** `Song` object and
 * it is edited in place. The deck reads `song.tracks` afresh on every pump, so a note toggled in
 * the grid is picked up at the next step with no restart — which is what a sequencer has to feel
 * like. Tempo is the exception: `stepSec` is computed once when a song is handed over, so a change
 * of bpm genuinely does mean handing it over again, and the loop restarts. That is honest rather
 * than annoying; a tempo change mid-loop is a thing you cannot un-hear anyway.
 */

import { validateSong, type BusName, type Song } from '@latticekit/audio';
import { BEDS, BED_BY_ID } from '../audio/beds.js';
import { INSTRUMENTS, INSTRUMENT_BY_ID } from '../audio/instruments.js';
import { PATTERNS, PATTERN_BY_ID, type MutableNote } from '../audio/patterns.js';
import { SKETCHES } from '../audio/kit.js';
import { renderArrangement, type Hit } from '../audio/offline.js';
import { encodeWav, download, normalise as normalisePeak, peakOf, trimTail } from '../audio/wav.js';
import { applyMixer, audio, driveBed, musicDeck, play, setBed, setMaxPan, unlock } from '../audio/live.js';
import {
  floorFromPattern, kitOf, mixerStateOf, secondsPerBar, songOf, type State, type WorkTrack,
} from '../state.js';
import { $, clear, debounce, el } from './dom.js';
import { createLens } from './lens.js';
import { startRoll, type Roll } from './roll.js';

/** Three keyboard rows, twenty-four keys, in the order a hand finds them. */
const PAD_KEYS = 'qwertyuiopasdfghjkl;zxcv'.split('');

const BUS_ROWS: readonly { bus: BusName; name: string; note: string }[] = [
  { bus: 'master', name: 'master', note: 'Everything. Set by arithmetic, not by the meter — nothing here is compressed or limited.' },
  { bus: 'music', name: 'music', note: 'The sequencer only.' },
  { bus: 'sfx', name: 'sfx', note: 'The bed, and the pads that are world sounds rather than interface ones.' },
  { bus: 'ui', name: 'ui', note: 'The interface pads. A player who mutes music must keep these.' },
];

export interface Floor {
  refresh(): void;
  enter(): void;
  leave(): void;
}

export function mountFloor(state: State, changed: () => void): Floor {
  const floor = state.floor;

  const patternHost = $('#patterns');
  const patternNote = $('#pattern-note');
  const songAxes = $('#song-axes');
  const progressionHost = $('#progression');
  const bedHost = $('#beds');
  const bedNote = $('#bed-note');
  const bedAxes = $('#bed-axes');
  const mixerHost = $('#mixer');
  const rulerHost = $('#ruler');
  const tracksHost = $('#tracks');
  const padsHost = $('#pads');
  const transport = $<HTMLButtonElement>('#transport');
  const recButton = $<HTMLButtonElement>('#rec');
  const transportReadout = $('#transport-readout');
  const songCheck = $('#song-check');
  const status = $('#floor-status');
  const barsInput = $<HTMLInputElement>('#bars');
  const barsValue = $('#bars-value');
  const voicesInput = $<HTMLInputElement>('#voices');
  const voicesValue = $('#voices-value');
  const instrumentSelect = $<HTMLSelectElement>('#add-instrument');
  const normaliseTake = $<HTMLInputElement>('#normalise-take');

  /** The one song object. See the note at the top of the file. */
  const liveSong = songOf(floor) as unknown as Record<string, unknown> & Song;

  let startedAt = 0;
  /**
   * Whether the *transport* is running, which is not the same question as `deck.playing`.
   *
   * Auditioning a note while stopped borrows the deck for seven hundred milliseconds — the deck is
   * the only thing that knows how to turn an instrument and a chord into a note — and during that
   * window `deck.playing` is true while the transport plainly is not. Reading the deck for this
   * would put a bar counter on screen under a button that says Play.
   */
  let playing = false;
  let armed = false;
  let hits: Hit[] = [];
  let roll: Roll | null = null;
  let tick = 0;
  let lastStep = -1;

  /* ------------------------------------------------------------------------------------------
     Song plumbing
     ------------------------------------------------------------------------------------------ */

  function syncSong(restart: boolean): void {
    Object.assign(liveSong, songOf(floor));
    const deck = musicDeck();
    deck.setIntensity(floor.intensity);
    for (const track of floor.tracks) deck.setTrackMuted(track.id, track.muted);
    if (restart && playing) {
      deck.play(liveSong, { fadeSec: 0.05 });
      startedAt = audio().now();
    }
    refreshSongCheck();
  }

  function syncMixer(): void {
    applyMixer(floor.gains, floor.mutedBuses, floor.maxVoices, floor.maxPan);
  }

  function syncBed(): void {
    const preset = BED_BY_ID.get(floor.bed) ?? BEDS[0]!;
    setBed(preset.id, preset.layers, preset.options, floor.bedLevel, floor.bedTone);
  }

  /* ------------------------------------------------------------------------------------------
     Transport
     ------------------------------------------------------------------------------------------ */

  function setPlaying(next: boolean): void {
    const deck = musicDeck();
    playing = next;
    if (next) {
      unlock();
      syncMixer();
      syncBed();
      syncSong(false);
      deck.play(liveSong);
      startedAt = audio().now();
      transport.textContent = 'Stop';
    } else {
      deck.stop();
      // Disarm, but keep the take: somebody who has just recorded something and pressed stop wants
      // to render it, and wiping it here would be the one destructive thing on this page.
      armed = false;
      transport.textContent = 'Play';
    }
    refreshRec();
  }

  transport.addEventListener('click', () => { setPlaying(!playing); });

  recButton.addEventListener('click', () => {
    armed = !armed;
    if (armed && !playing) setPlaying(true);
    if (armed) hits = [];
    refreshRec();
  });

  function refreshRec(): void {
    recButton.setAttribute('aria-pressed', String(armed));
    recButton.textContent = armed ? `● Recording — ${String(hits.length)} hits` : hits.length > 0 ? `● Take: ${String(hits.length)} hits` : '● Arm take';
    recButton.style.color = armed ? 'var(--spot)' : '';
    recButton.style.borderColor = armed ? 'var(--spot)' : '';
  }

  /* ------------------------------------------------------------------------------------------
     Patterns
     ------------------------------------------------------------------------------------------ */

  function buildPatterns(): void {
    clear(patternHost);
    for (const pattern of PATTERNS) {
      const button = el('button', { class: 'pick', type: 'button' }, [
        el('span', { class: 'pick__name', text: pattern.name }),
        el('span', { class: 'pick__tag', text: `${String(pattern.song.bpm)} bpm` }),
      ]);
      button.dataset['id'] = pattern.id;
      button.addEventListener('click', () => {
        Object.assign(floor, floorFromPattern(pattern.id));
        buildTracks();
        refreshPatterns();
        refreshSongAxes();
        refreshProgression();
        refreshBeds();
        refreshMixer();
        syncBed();
        syncSong(false);
        if (playing) { musicDeck().play(liveSong, { fadeSec: 0.2 }); startedAt = audio().now(); }
        changed();
      });
      patternHost.append(button);
    }
  }

  function refreshPatterns(): void {
    for (const button of patternHost.querySelectorAll<HTMLButtonElement>('.pick')) {
      button.setAttribute('aria-pressed', button.dataset['id'] === floor.pattern ? 'true' : 'false');
    }
    patternNote.textContent = (PATTERN_BY_ID.get(floor.pattern) ?? PATTERNS[0]!).note;
  }

  /* ------------------------------------------------------------------------------------------
     Song axes
     ------------------------------------------------------------------------------------------ */

  interface SongAxis {
    id: string;
    label: string;
    low: number;
    high: number;
    step: number;
    note?: string;
    get(): number;
    set(value: number): void;
    format(value: number): string;
    restart?: boolean;
  }

  const NOTE_NAMES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];

  const SONG_AXES: readonly SongAxis[] = [
    {
      id: 'bpm', label: 'Tempo', low: 60, high: 168, step: 1, restart: true,
      note: 'Handing the deck a new tempo restarts the loop, because a step length is worked out once when a song is handed over. Nothing else here does.',
      get: () => floor.bpm, set: (v) => { floor.bpm = v; }, format: (v) => `${String(v)} bpm`,
    },
    {
      id: 'root', label: 'Key', low: -12, high: 12, step: 1,
      note: 'The root every bar is an offset from. It moves under the loop without interrupting it.',
      get: () => floor.rootKey,
      set: (v) => { floor.rootKey = v; },
      format: (v) => `${NOTE_NAMES[((v % 12) + 12) % 12]!}${String(1 + Math.floor((v + 9) / 12))}`,
    },
    {
      id: 'intensity', label: 'Intensity', low: 0, high: 100, step: 1,
      note: 'Gates tracks by the minimum they asked for. It never changes tempo — that is the point of having it.',
      get: () => Math.round(floor.intensity * 100), set: (v) => { floor.intensity = v / 100; }, format: (v) => `${String(v)}%`,
    },
    {
      id: 'seed', label: 'Seed', low: 0, high: 99, step: 1,
      note: 'Which notes the drops drop. Stateless and hashed per note, so muting one track cannot shift what any other track plays, and the same seed is the same twenty minutes on every machine.',
      get: () => floor.seed, set: (v) => { floor.seed = v; }, format: (v) => `#${String(v)}`,
    },
  ];

  function buildSongAxes(): void {
    clear(songAxes);
    const lens = createLens('Tempo, key, how much of the arrangement is speaking, and which notes the drops drop. Point at one to read what it does.');
    songAxes.append(lens.node);
    for (const axis of SONG_AXES) {
      const value = el('span', { class: 'axis__value', text: axis.format(axis.get()) });
      const input = el('input', { type: 'range', min: String(axis.low), max: String(axis.high), step: String(axis.step) }) as HTMLInputElement;
      input.dataset['axis'] = axis.id;
      input.value = String(axis.get());
      input.addEventListener('input', () => {
        axis.set(Number(input.value));
        value.textContent = axis.format(axis.get());
        syncSong(false);
        changed();
      });
      input.addEventListener('change', () => { if (axis.restart === true) syncSong(true); });
      const row = el('div', { class: 'axis' }, [
        el('div', { class: 'axis__head' }, [el('span', { class: 'axis__label', text: axis.label }), value]),
        input,
      ]);
      if (axis.note !== undefined) lens.watch(row, axis.label, axis.note);
      songAxes.append(row);
    }
  }

  function refreshSongAxes(): void {
    for (const axis of SONG_AXES) {
      const input = songAxes.querySelector<HTMLInputElement>(`input[data-axis="${axis.id}"]`);
      if (input === null) continue;
      input.value = String(axis.get());
      const value = input.parentElement?.querySelector('.axis__value');
      if (value) value.textContent = axis.format(axis.get());
    }
  }

  function refreshProgression(): void {
    clear(progressionHost);
    floor.progression.forEach((semis, bar) => {
      const input = el('input', { class: 'field__input', type: 'number', min: '-12', max: '12', step: '1' }) as HTMLInputElement;
      input.value = String(semis);
      input.style.flex = '1 1 2.4rem';
      input.style.padding = '0.3rem 0.35rem';
      input.style.textAlign = 'center';
      input.title = `Bar ${String(bar + 1)}`;
      input.addEventListener('input', () => {
        const next = Math.max(-12, Math.min(12, Math.round(Number(input.value) || 0)));
        floor.progression[bar] = next;
        syncSong(false);
        changed();
      });
      progressionHost.append(input);
    });
    const fewer = el('button', { class: 'ghost', type: 'button', text: '−', title: 'One bar shorter' }) as HTMLButtonElement;
    const more = el('button', { class: 'ghost', type: 'button', text: '+', title: 'One bar longer' }) as HTMLButtonElement;
    fewer.style.cssText = 'flex:0 0 1.9rem;padding:0.3rem 0';
    more.style.cssText = 'flex:0 0 1.9rem;padding:0.3rem 0';
    fewer.disabled = floor.progression.length < 2;
    more.disabled = floor.progression.length > 7;
    fewer.addEventListener('click', () => {
      floor.progression.pop();
      for (const track of floor.tracks) if (track.bars) track.bars = track.bars.filter((b) => b < floor.progression.length);
      refreshProgression();
      syncSong(false);
      changed();
    });
    more.addEventListener('click', () => {
      floor.progression.push(0);
      refreshProgression();
      syncSong(false);
      changed();
    });
    progressionHost.append(fewer, more);
  }

  /* ------------------------------------------------------------------------------------------
     Beds
     ------------------------------------------------------------------------------------------ */

  function buildBeds(): void {
    clear(bedHost);
    for (const preset of BEDS) {
      const button = el('button', { class: 'pick', type: 'button' }, [
        el('span', { class: 'pick__name', text: preset.name }),
        el('span', { class: 'pick__tag', text: preset.layers.length > 0 ? `${String(preset.layers.length)} layers` : '—' }),
      ]);
      button.dataset['id'] = preset.id;
      button.addEventListener('click', () => {
        floor.bed = preset.id;
        refreshBeds();
        unlock();
        syncBed();
        changed();
      });
      bedHost.append(button);
    }

    const lens = createLens('Two numbers drive the whole bed. Point at one to read what it moves.');
    bedAxes.append(lens.node);
    for (const [id, label, note, get, set] of [
      ['level', 'Level', 'Scales gain and opens the filters together. At zero the bed is silent rather than quiet — an empty room should be empty.', () => floor.bedLevel, (v: number) => { floor.bedLevel = v; }],
      ['tone', 'Tone', 'Sags the pitch, closes the top end, and crossfades the banded layers past each other. A level drop reads as somebody moving a fader; a pitch drop reads as machinery winding down.', () => floor.bedTone, (v: number) => { floor.bedTone = v; }],
    ] as const) {
      const value = el('span', { class: 'axis__value', text: `${String(Math.round(get() * 100))}%` });
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1' }) as HTMLInputElement;
      input.dataset['bed'] = id;
      input.value = String(Math.round(get() * 100));
      input.addEventListener('input', () => {
        set(Number(input.value) / 100);
        value.textContent = `${input.value}%`;
        driveBed(floor.bedLevel, floor.bedTone);
        changed();
      });
      const row = el('div', { class: 'axis' }, [
        el('div', { class: 'axis__head' }, [el('span', { class: 'axis__label', text: label }), value]),
        input,
      ]);
      lens.watch(row, label, note);
      bedAxes.append(row);
    }
  }

  function refreshBeds(): void {
    for (const button of bedHost.querySelectorAll<HTMLButtonElement>('.pick')) {
      button.setAttribute('aria-pressed', button.dataset['id'] === floor.bed ? 'true' : 'false');
    }
    bedNote.textContent = (BED_BY_ID.get(floor.bed) ?? BEDS[0]!).note;
    for (const [id, get] of [['level', () => floor.bedLevel], ['tone', () => floor.bedTone]] as const) {
      const input = bedAxes.querySelector<HTMLInputElement>(`input[data-bed="${id}"]`);
      if (input === null) continue;
      input.value = String(Math.round(get() * 100));
      const value = input.parentElement?.querySelector('.axis__value');
      if (value) value.textContent = `${input.value}%`;
    }
  }

  /* ------------------------------------------------------------------------------------------
     Mixer
     ------------------------------------------------------------------------------------------ */

  function buildMixer(): void {
    clear(mixerHost);
    for (const row of BUS_ROWS) {
      const value = el('span', { class: 'mix__value' });
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1' }) as HTMLInputElement;
      input.dataset['bus'] = row.bus;
      const mute = el('button', { class: 'trk__mute', type: 'button', text: 'M', title: `Mute ${row.name}` }) as HTMLButtonElement;
      mute.dataset['bus'] = row.bus;
      input.addEventListener('input', () => {
        floor.gains[row.bus] = Number(input.value) / 100;
        value.textContent = `${input.value}%`;
        audio().mixer.setGain(row.bus, floor.gains[row.bus]);
        changed();
      });
      mute.addEventListener('click', () => {
        floor.mutedBuses[row.bus] = !floor.mutedBuses[row.bus];
        audio().mixer.setMuted(row.bus, floor.mutedBuses[row.bus]);
        mute.setAttribute('aria-pressed', String(floor.mutedBuses[row.bus]));
        changed();
      });
      const name = el('span', { class: 'mix__name', text: row.name, title: row.note });
      name.dataset['bus'] = row.bus;
      mixerHost.append(el('div', { class: 'mix' }, [name, input, value, mute]));
    }
    refreshMixer();
  }

  function refreshMixer(): void {
    for (const row of BUS_ROWS) {
      const input = mixerHost.querySelector<HTMLInputElement>(`input[data-bus="${row.bus}"]`);
      const mute = mixerHost.querySelector<HTMLButtonElement>(`button[data-bus="${row.bus}"]`);
      if (input) {
        input.value = String(Math.round(floor.gains[row.bus] * 100));
        const value = input.parentElement?.querySelector('.mix__value');
        if (value) value.textContent = `${input.value}%`;
      }
      mute?.setAttribute('aria-pressed', String(floor.mutedBuses[row.bus]));
    }
    normaliseTake.checked = floor.normaliseTake;
    voicesInput.value = String(floor.maxVoices);
    voicesValue.textContent = String(floor.maxVoices);
    widthInput.value = String(Math.round(floor.maxPan * 100));
    widthValue.textContent = floor.maxPan === 0 ? 'mono' : `${widthInput.value}%`;
    detuneInput.value = String(floor.padDetune);
    detuneValue.textContent = floor.padDetune === 0 ? 'as designed' : `${floor.padDetune > 0 ? '+' : '−'}${String(Math.abs(floor.padDetune))} semitones`;
    barsInput.value = String(floor.bars);
    barsValue.textContent = `${String(floor.bars)} bars · ${(floor.bars * secondsPerBar(floor)).toFixed(1)} s`;
  }

  const widthInput = $<HTMLInputElement>('#width');
  const widthValue = $('#width-value');
  const detuneInput = $<HTMLInputElement>('#pad-detune');
  const detuneValue = $('#pad-detune-value');

  widthInput.addEventListener('input', () => {
    floor.maxPan = Number(widthInput.value) / 100;
    widthValue.textContent = floor.maxPan === 0 ? 'mono' : `${widthInput.value}%`;
    setMaxPan(floor.maxPan);
    changed();
  });

  detuneInput.addEventListener('input', () => {
    floor.padDetune = Number(detuneInput.value);
    detuneValue.textContent = floor.padDetune === 0 ? 'as designed' : `${floor.padDetune > 0 ? '+' : '−'}${String(Math.abs(floor.padDetune))} semitones`;
    changed();
  });

  voicesInput.addEventListener('input', () => {
    floor.maxVoices = Number(voicesInput.value);
    voicesValue.textContent = String(floor.maxVoices);
    audio().setMaxVoices(floor.maxVoices);
    changed();
  });

  normaliseTake.addEventListener('change', () => {
    floor.normaliseTake = normaliseTake.checked;
    changed();
  });

  barsInput.addEventListener('input', () => {
    floor.bars = Number(barsInput.value);
    barsValue.textContent = `${String(floor.bars)} bars · ${(floor.bars * secondsPerBar(floor)).toFixed(1)} s`;
    changed();
  });

  /* ------------------------------------------------------------------------------------------
     The grid
     ------------------------------------------------------------------------------------------ */

  function noteAt(track: WorkTrack, step: number): MutableNote | undefined {
    return track.notes.find((note) => note.step === step);
  }

  function buildRuler(): void {
    clear(rulerHost);
    const cells = el('div', { class: 'ruler__cells' });
    for (let step = 0; step < 16; step += 1) {
      const span = el('span', { text: step % 4 === 0 ? String(step / 4 + 1) : '·' });
      span.dataset['beat'] = step % 4 === 0 ? '1' : '0';
      span.dataset['step'] = String(step);
      cells.append(span);
    }
    rulerHost.append(el('div', { class: 'ruler' }, [el('div', { class: 'ruler__side', text: 'beat' }), cells]));
  }

  function buildTracks(): void {
    clear(tracksHost);
    for (const track of floor.tracks) {
      const instrument = INSTRUMENT_BY_ID.get(track.instrument);
      const row = el('div', { class: `trk${track.muted ? ' trk--muted' : ''}` });
      row.dataset['track'] = track.id;

      const name = el('button', { class: 'trk__name', type: 'button', text: track.id, title: instrument?.note ?? '' }) as HTMLButtonElement;
      name.addEventListener('click', () => { openTrackMenu(track, name); });

      const mute = el('button', { class: 'trk__mute', type: 'button', text: 'M', title: 'Mute this track' }) as HTMLButtonElement;
      mute.setAttribute('aria-pressed', String(track.muted));
      mute.addEventListener('click', () => {
        track.muted = !track.muted;
        mute.setAttribute('aria-pressed', String(track.muted));
        row.classList.toggle('trk--muted', track.muted);
        musicDeck().setTrackMuted(track.id, track.muted);
        changed();
      });

      const remove = el('button', { class: 'trk__mute', type: 'button', text: '×', title: 'Remove this track' }) as HTMLButtonElement;
      remove.addEventListener('click', () => {
        floor.tracks = floor.tracks.filter((t) => t !== track);
        buildTracks();
        syncSong(false);
        changed();
      });

      row.append(el('div', { class: 'trk__side' }, [name, mute, remove]));

      const cells = el('div', { class: 'cells' });
      for (let step = 0; step < 16; step += 1) {
        const cell = el('button', {
          class: 'cell',
          type: 'button',
          'aria-label': `${track.id}, step ${String(step + 1)} of 16`,
        }) as HTMLButtonElement;
        cell.dataset['step'] = String(step);
        cell.append(el('span', { class: 'cell__n' }));
        wireCell(cell, track, step, instrument?.melodic === true);
        cells.append(cell);
      }
      row.append(cells);
      tracksHost.append(row);
      paintTrack(track);
    }
    refreshSongCheck();
  }

  function paintTrack(track: WorkTrack): void {
    const row = tracksHost.querySelector<HTMLElement>(`[data-track="${track.id}"]`);
    if (row === null) return;
    const melodic = INSTRUMENT_BY_ID.get(track.instrument)?.melodic === true;
    for (const cell of row.querySelectorAll<HTMLButtonElement>('.cell')) {
      const step = Number(cell.dataset['step']);
      const note = noteAt(track, step);
      cell.dataset['on'] = note ? '1' : '0';
      const label = cell.querySelector('.cell__n');
      if (label) label.textContent = note && melodic ? String(note.semis ?? 0) : '';
      cell.style.setProperty('--fill', note && melodic ? `${String(Math.min(100, Math.max(0, ((note.semis ?? 0) / 24) * 100)))}%` : '0%');
    }
  }

  function wireCell(cell: HTMLButtonElement, track: WorkTrack, step: number, melodic: boolean): void {
    let startY = 0;
    let startSemis = 0;
    let dragged = false;
    let wasOn = false;
    let pointer = -1;

    // One handler, because the decision this makes depends on the order two things happened in.
    // A click on an empty cell places a note; a click on a filled one removes it; a *drag* on
    // either moves its pitch and never removes anything. Splitting that across two listeners on
    // the same element gets the order wrong at the target phase and turns every placement into an
    // immediate deletion.
    cell.addEventListener('pointerdown', (event) => {
      unlock();
      pointer = event.pointerId;
      // Capture so a drag that leaves the cell keeps moving this note rather than the next one.
      // It throws for a pointer the element does not own, which must not be allowed to abandon
      // the rest of this handler — the drag would then start from an unset origin and jump.
      try {
        cell.setPointerCapture(pointer);
      } catch {
        // No capture. The drag still works; it just ends when the pointer leaves.
      }
      startY = event.clientY;
      dragged = false;
      const existing = noteAt(track, step);
      wasOn = existing !== undefined;
      if (existing === undefined) {
        track.notes.push({ step, semis: 0 });
        track.notes.sort((a, b) => a.step - b.step);
        startSemis = 0;
        paintTrack(track);
        syncSong(false);
        changed();
        if (!playing) previewNote(track, 0);
      } else {
        startSemis = existing.semis ?? 0;
      }
      event.preventDefault();
    });

    cell.addEventListener('pointermove', (event) => {
      if (pointer < 0 || !melodic) return;
      const delta = Math.round((startY - event.clientY) / 7);
      if (delta === 0 && !dragged) return;
      dragged = true;
      const note = noteAt(track, step);
      if (note === undefined) return;
      const next = Math.max(-12, Math.min(24, startSemis + delta));
      if ((note.semis ?? 0) === next) return;
      note.semis = next;
      paintTrack(track);
      syncSong(false);
      if (!playing) previewNote(track, next);
    });

    const finish = (): void => {
      if (pointer < 0) return;
      try {
        if (cell.hasPointerCapture(pointer)) cell.releasePointerCapture(pointer);
      } catch {
        // Already released, or never held.
      }
      pointer = -1;
      if (!dragged && wasOn) {
        track.notes = track.notes.filter((note) => note.step !== step);
        paintTrack(track);
        syncSong(false);
      }
      changed();
    };

    cell.addEventListener('pointerup', finish);
    cell.addEventListener('pointercancel', finish);
    cell.addEventListener('keydown', (event) => {
      if (!melodic) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const note = noteAt(track, step);
      if (note === undefined) return;
      event.preventDefault();
      note.semis = Math.max(-12, Math.min(24, (note.semis ?? 0) + (event.key === 'ArrowUp' ? 1 : -1)));
      paintTrack(track);
      syncSong(false);
      previewNote(track, note.semis);
      changed();
    });
  }

  /** One note of a track, on its own, so editing while stopped is not editing in silence. */
  function previewNote(track: WorkTrack, semis: number): void {
    const instrument = INSTRUMENT_BY_ID.get(track.instrument);
    if (instrument === undefined) return;
    unlock();
    const engine = audio();
    if (!engine.available) return;
    // The deck owns note rendering, so a preview borrows the pad path: a one-shot table entry is
    // the wrong shape for an instrument, and building a second engine for a preview is not on.
    if (playing) return;
    const deck = musicDeck();
    const preview: Song = {
      bpm: floor.bpm, steps: 16, rootHz: liveSong.rootHz, progression: [floor.progression[0] ?? 0], seed: 0,
      tracks: [{ id: track.id, voice: instrument.voice, notes: [{ step: 0, semis }], melodic: instrument.melodic }],
    };
    deck.play(preview, { fadeSec: 0 });
    setTimeout(() => { if (deck.song === preview) deck.stop({ fadeSec: 0.2 }); }, 700);
  }

  /**
   * The per-track panel.
   *
   * Positioned `fixed` rather than absolutely inside the row, because the grid lives in a
   * horizontal scroller — and a box that overflows a scroller is a box that gets clipped, or that
   * grows a second scrollbar nobody asked for. Fixed costs a reposition on scroll; the alternative
   * costs the panel.
   */
  let openMenu: (() => void) | null = null;

  function openTrackMenu(track: WorkTrack, anchor: HTMLElement): void {
    const wasMine = anchor.dataset['menu'] === 'open';
    openMenu?.();
    if (wasMine) return;

    const instrument = INSTRUMENT_BY_ID.get(track.instrument);
    const menu = el('div', { class: 'trk__menu' });
    anchor.dataset['menu'] = 'open';

    const place = (): void => {
      const box = anchor.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      const left = Math.min(box.left, window.innerWidth - size.width - 10);
      // Below the row if it fits, above it if it does not, and always inside the viewport — the
      // grid scrolls, so the anchor can be anywhere including off the top of the screen.
      const below = box.bottom + 4;
      const top = below + size.height <= window.innerHeight - 8 ? below : box.top - size.height - 4;
      menu.style.left = `${String(Math.max(8, left))}px`;
      menu.style.top = `${String(Math.max(8, Math.min(top, window.innerHeight - size.height - 8)))}px`;
    };

    const close = (): void => {
      menu.remove();
      delete anchor.dataset['menu'];
      window.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      openMenu = null;
    };

    function onOutside(event: PointerEvent): void {
      if (event.target instanceof Node && (menu.contains(event.target) || anchor.contains(event.target))) return;
      close();
    }
    function onEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') close();
    }

    const select = el('select', { class: 'field__input' }) as HTMLSelectElement;
    for (const option of INSTRUMENTS) {
      const node = el('option', { value: option.id, text: `${option.name} — ${option.kind}` });
      if (option.id === track.instrument) node.selected = true;
      select.append(node);
    }
    select.addEventListener('change', () => {
      track.instrument = select.value;
      close();
      buildTracks();
      syncSong(false);
      changed();
    });

    menu.append(el('span', { class: 'field__label', text: 'Instrument' }), select);
    menu.append(el('p', { class: 'axis__note', text: instrument?.note ?? '' }));

    for (const [label, note, get, set, high] of [
      ['Drop', 'Chance a note is skipped, decided by the song\u2019s seeded hash rather than by chance. Past about a fifth the part stops being recognisable.', () => track.drop, (v: number) => { track.drop = v; }, 40],
      ['Comes in at', 'Silent below this intensity. This is how one pattern becomes an arrangement.', () => track.minIntensity, (v: number) => { track.minIntensity = v; }, 100],
    ] as const) {
      const value = el('span', { class: 'axis__value', text: `${String(Math.round(get() * 100))}%` });
      const input = el('input', { type: 'range', min: '0', max: String(high), step: '1' }) as HTMLInputElement;
      input.value = String(Math.round(get() * 100));
      input.addEventListener('input', () => {
        set(Number(input.value) / 100);
        value.textContent = `${input.value}%`;
        syncSong(false);
        changed();
      });
      menu.append(el('div', { class: 'axis' }, [
        el('div', { class: 'axis__head' }, [el('span', { class: 'axis__label', text: label }), value]),
        input,
        el('p', { class: 'axis__note', text: note }),
      ]));
    }

    const barsRow = el('div', { class: 'row' });
    for (let bar = 0; bar < floor.progression.length; bar += 1) {
      const on = track.bars === null || track.bars.includes(bar);
      const button = el('button', { class: 'ghost', type: 'button', text: String(bar + 1) }) as HTMLButtonElement;
      button.setAttribute('aria-pressed', String(on));
      button.style.cssText = on ? 'background:var(--ink);color:var(--paper);border-color:var(--ink)' : '';
      button.addEventListener('click', () => {
        const all = Array.from({ length: floor.progression.length }, (_, index) => index);
        const set = new Set(track.bars ?? all);
        if (set.has(bar)) set.delete(bar);
        else set.add(bar);
        const next = [...set].sort((a, b) => a - b);
        // A part that speaks on every bar has no mask at all, which is both smaller to save and
        // the thing `bars: undefined` already means.
        track.bars = next.length === floor.progression.length ? null : next;
        close();
        openTrackMenu(track, anchor);
        syncSong(false);
        changed();
      });
      barsRow.append(button);
    }
    menu.append(el('span', { class: 'field__label', text: 'Speaks on bars' }), barsRow);
    menu.append(el('p', { class: 'axis__note', text: 'Sitting a part out of some bars is the cheapest way to stop a loop announcing where it begins.' }));

    const done = el('button', { class: 'ghost ghost--wide', type: 'button', text: 'Close' }) as HTMLButtonElement;
    done.style.marginTop = '0.5rem';
    done.addEventListener('click', close);
    menu.append(done);

    document.body.append(menu);
    place();
    openMenu = close;
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onEscape, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  }

  instrumentSelect.append(...INSTRUMENTS.map((instrument) => el('option', { value: instrument.id, text: `${instrument.name} — ${instrument.kind}` })));

  $('#add-track').addEventListener('click', () => {
    const instrument = INSTRUMENT_BY_ID.get(instrumentSelect.value);
    if (instrument === undefined) return;
    let id = instrument.id;
    let n = 2;
    while (floor.tracks.some((track) => track.id === id)) id = `${instrument.id}-${String(n++)}`;
    floor.tracks.push({ id, instrument: instrument.id, notes: [], bars: null, drop: 0, minIntensity: 0, muted: false });
    buildTracks();
    syncSong(false);
    changed();
  });

  function refreshSongCheck(): void {
    const problems = validateSong(liveSong);
    clear(songCheck);
    if (problems.length === 0) {
      songCheck.className = 'check check--ok';
      songCheck.textContent =
        'The song passes. No step sums past the ceiling, every melodic track leaves room to breathe, and no part is scheduled on a bar that does not exist.';
      return;
    }
    songCheck.className = 'check check--bad';
    songCheck.append(el('span', { text: `${String(problems.length)} problem${problems.length === 1 ? '' : 's'}:` }));
    const list = el('ul');
    for (const problem of problems.slice(0, 6)) list.append(el('li', {}, [el('code', { text: problem.code }), ' — ', problem.message]));
    songCheck.append(list);
  }

  /* ------------------------------------------------------------------------------------------
     Pads
     ------------------------------------------------------------------------------------------ */

  const padByKey = new Map<string, HTMLButtonElement>();

  function buildPads(): void {
    clear(padsHost);
    padByKey.clear();
    SKETCHES.forEach((sketch, index) => {
      const key = PAD_KEYS[index] ?? '';
      const button = el('button', { class: 'pad', type: 'button', title: sketch.note }, [
        el('span', { class: 'pad__key', text: key.toUpperCase() }),
        el('span', { class: 'pad__name', text: sketch.label }),
      ]) as HTMLButtonElement;
      button.dataset['id'] = sketch.id;
      button.addEventListener('pointerdown', () => { hit(sketch.id); });
      padsHost.append(button);
      if (key !== '') padByKey.set(key, button);
    });
  }

  function hit(id: string): void {
    // Pan comes from where the pad sits across the row, and reaches the engine as an *event*
    // property rather than as part of the recipe — which is the distinction the package draws and
    // the reason most of these ignore it. A sound is only spatial if it opted in, and `ui` sounds
    // do not: an interface click that slides across the stereo field as you move is the most
    // disorienting thing this engine can do. The three on `sfx` will move; the other twenty-one
    // will not, and that is the demonstration rather than a shortcoming.
    const pad = padsHost.querySelector<HTMLElement>(`[data-id="${id}"]`);
    let pan = 0;
    if (pad !== null) {
      const row = padsHost.getBoundingClientRect();
      const box = pad.getBoundingClientRect();
      if (row.width > 0) pan = ((box.left + box.width / 2 - row.left) / row.width) * 2 - 1;
    }
    const accepted = play(id, { pan, detune: floor.padDetune });
    if (pad) {
      pad.classList.add('pad--lit');
      setTimeout(() => { pad.classList.remove('pad--lit'); }, accepted ? 110 : 40);
    }
    if (armed && playing) {
      hits.push({ id, at: Math.max(0, audio().now() - startedAt) });
      refreshRec();
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === ' ') {
      event.preventDefault();
      setPlaying(!playing);
      return;
    }
    const pad = padByKey.get(event.key.toLowerCase());
    if (pad === undefined) return;
    event.preventDefault();
    hit(pad.dataset['id'] ?? '');
  };

  /* ------------------------------------------------------------------------------------------
     Export
     ------------------------------------------------------------------------------------------ */

  let busy = false;

  ($('#dl-take') as HTMLButtonElement).addEventListener('click', () => {
    if (busy) return;
    busy = true;
    status.textContent = 'Rendering the take…';
    status.className = 'status status--busy';
    const seconds = floor.bars * secondsPerBar(floor);
    const preset = BED_BY_ID.get(floor.bed) ?? BEDS[0]!;
    void renderArrangement({
      sounds: kitOf(state.bench),
      song: songOf(floor),
      bed: preset.layers.length > 0 ? { layers: preset.layers, level: floor.bedLevel, tone: floor.bedTone } : null,
      hits,
      intensity: floor.intensity,
      mutedTracks: floor.tracks.filter((track) => track.muted).map((track) => track.id),
      mixer: mixerStateOf(floor),
      seconds,
    }).then((raw) => {
      const trimmed = trimTail(raw, 0.0004, 0.15);
      const buffer = floor.normaliseTake ? normalisePeak(trimmed, 0.891) : trimmed;
      const bytes = encodeWav(buffer);
      const name = `${floor.pattern}-${String(floor.bars)}bars`;
      download(`${name}.wav`, bytes, 'audio/wav');
      status.textContent = `${name}.wav — ${buffer.duration.toFixed(1)} s, peak ${(20 * Math.log10(Math.max(0.00001, peakOf(buffer)))).toFixed(1)} dBFS, ${(bytes.length / 1024 / 1024).toFixed(2)} MB.`.replace('-', '−');
      status.className = 'status';
      busy = false;
    });
  });

  $('#share-floor').addEventListener('click', () => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => { status.textContent = 'Link copied — it carries the pattern, the bed and the mix.'; },
      () => { status.textContent = 'The browser refused the clipboard.'; },
    );
  });

  /* ------------------------------------------------------------------------------------------
     The frame
     ------------------------------------------------------------------------------------------ */

  function frame(): void {
    tick = requestAnimationFrame(frame);
    const stepSec = 60 / floor.bpm / 4;
    if (playing) {
      const elapsed = audio().now() - startedAt;
      const absolute = Math.max(0, Math.floor(elapsed / stepSec));
      const step = absolute % 16;
      const bar = Math.floor(absolute / 16) % Math.max(1, floor.progression.length);
      if (step !== lastStep) {
        lastStep = step;
        for (const span of rulerHost.querySelectorAll<HTMLElement>('.ruler__cells span')) {
          span.dataset['now'] = span.dataset['step'] === String(step) ? '1' : '0';
        }
      }
      transportReadout.textContent = '';
      for (const [label, value] of [
        ['bar', `${String(bar + 1)} / ${String(floor.progression.length)}`],
        ['step', String(step + 1)],
        ['elapsed', `${elapsed.toFixed(1)} s`],
      ] as const) {
        transportReadout.append(el('span', {}, [label, el('b', { text: value })]));
      }
    } else if (lastStep !== -1) {
      lastStep = -1;
      for (const span of rulerHost.querySelectorAll<HTMLElement>('.ruler__cells span')) span.dataset['now'] = '0';
      transportReadout.textContent = 'stopped — space plays, the letter keys are pads';
    }
  }

  buildPatterns();
  buildSongAxes();
  buildBeds();
  buildMixer();
  buildRuler();
  buildTracks();
  buildPads();
  refreshPatterns();
  refreshBeds();
  refreshProgression();
  transportReadout.textContent = 'stopped — space plays, the letter keys are pads';

  window.addEventListener('resize', debounce(160, () => { buildRuler(); }));

  return {
    refresh() {
      refreshPatterns();
      refreshSongAxes();
      refreshProgression();
      refreshBeds();
      refreshMixer();
      buildTracks();
      syncSong(false);
    },
    enter() {
      roll ??= startRoll($<HTMLCanvasElement>('#roll'), $('#roll-readout'));
      window.addEventListener('keydown', onKey);
      if (tick === 0) tick = requestAnimationFrame(frame);
      syncMixer();
    },
    leave() {
      roll?.stop();
      roll = null;
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(tick);
      tick = 0;
    },
  };
}
