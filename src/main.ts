/**
 * Boot: read the URL, mount the two rooms, and never touch the audio device until somebody does.
 *
 * The last part is the only rule here that a visitor would notice if it were broken. A page that
 * starts making noise before it has been touched is worse than a silent one, and browsers refuse
 * it anyway — so this file installs the gesture listeners and calls `unlock()` from them, and
 * nothing anywhere else in the project reaches for an `AudioContext`.
 */

import { applyMixer, onUnlockChange, unlock } from './audio/live.js';
import { mountBench } from './ui/bench.js';
import { mountFloor } from './ui/floor.js';
import { $, debounce } from './ui/dom.js';
import { defaultState, readUrl, writeUrl, type State } from './state.js';

const state: State = readUrl() ?? defaultState();

const rooms = {
  bench: { tab: $('#tab-bench'), panel: $('#bench') },
  floor: { tab: $('#tab-floor'), panel: $('#floor') },
} as const;

// 400 ms rather than something snappier: this ends in `history.replaceState`, which Safari
// rate-limits to about a hundred calls per thirty seconds and then silently stops honouring. A
// slider dragged for half a minute would sail past that at 220.
const save = debounce(400, () => { writeUrl(state); });

const bench = mountBench(state, save);
const floor = mountFloor(state, save);

function show(room: 'bench' | 'floor'): void {
  state.room = room;
  for (const [name, parts] of Object.entries(rooms)) {
    const active = name === room;
    parts.tab.setAttribute('aria-selected', String(active));
    parts.panel.classList.toggle('hidden', !active);
  }
  if (room === 'floor') {
    floor.enter();
  } else {
    floor.leave();
    bench.enter();
  }
  save();
}

rooms.bench.tab.addEventListener('click', () => { show('bench'); });
rooms.floor.tab.addEventListener('click', () => { show('floor'); });

/* ----------------------------------------------------------------------------------------------
   The gesture
   ---------------------------------------------------------------------------------------------- */

const stateChip = $<HTMLButtonElement>('#audio-state');
const stateText = $('#audio-state-text');

onUnlockChange((unlocked) => {
  stateChip.dataset['state'] = unlocked;
  stateText.textContent =
    unlocked === 'ready' ? 'audio running' : unlocked === 'refused' ? 'audio unavailable here' : 'press to start audio';
});

// Called from every interaction rather than once: a tab left in the background long enough gets
// its context suspended, and a page that unlocks only on the first click works for one session and
// then goes quiet with nothing in the console to say why.
for (const event of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(event, () => { unlock(); }, { capture: true, passive: true });
}
stateChip.addEventListener('click', () => { unlock(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') unlock();
});

/* ----------------------------------------------------------------------------------------------
   Go
   ---------------------------------------------------------------------------------------------- */

// The mixer belongs to the page rather than to the floor: a bus muted there is still muted on the
// bench, and the bench says so rather than leaving somebody wondering why a sound went quiet.
applyMixer(state.floor.gains, state.floor.mutedBuses, state.floor.maxVoices, state.floor.maxPan);

bench.refresh();
floor.refresh();
show(state.room);
writeUrl(state);
