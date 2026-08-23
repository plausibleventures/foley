/**
 * Boot: read the URL, mount the two rooms, and never touch the audio device until somebody does.
 *
 * The last part is the only rule here that a visitor would notice if it were broken. A page that
 * starts making noise before it has been touched is worse than a silent one, and browsers refuse
 * it anyway — so this file installs the gesture listeners and calls `unlock()` from them, and
 * nothing anywhere else in the project reaches for an `AudioContext`.
 */

import { startAnalytics, track } from './analytics.js';
import { applyMixer, canClaimPlayback, onUnlockChange, unlock } from './audio/live.js';
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

let shown = '';

function show(room: 'bench' | 'floor'): void {
  if (room !== shown && shown !== '') track('room_switch', { to: room });
  shown = room;
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
const hush = $('#hush');

const STATE_TEXT: Record<string, string> = {
  waiting: 'press to start audio',
  ready: 'audio running',
  refused: 'audio unavailable here',
  blocked: 'audio blocked — tap here',
};

onUnlockChange((unlocked) => {
  stateChip.dataset['state'] = unlocked;
  stateText.textContent = STATE_TEXT[unlocked] ?? STATE_TEXT['waiting']!;
  // The one failure a page cannot detect: on an iPhone the ring/silent switch mutes the ambient
  // channel, and on iOS older than 16.4 there is no way to ask for the media channel instead.
  // Everything reports healthy and the speaker stays quiet, so the only honest thing is to say so.
  stateChip.title =
    unlocked === 'blocked'
      ? 'The audio device exists but is not running. Tap the page. On an iPhone, check the ring/silent switch on the side.'
      : unlocked === 'ready'
        ? 'Audio is running. On an iPhone, the side switch still has to be off silent.'
        : '';
  // Two different notices, because they are two different problems.
  //
  // `blocked` is a context that is not running, and tapping again usually fixes it. The other is
  // the one no page can detect: on iOS the ring/silent switch mutes web audio, and before Safari
  // 16.4 there is no way to ask for the media channel instead — so on those devices everything
  // reports healthy while the speaker stays quiet, and the only honest thing is to say so up front.
  const mute = unlocked === 'ready' && !canClaimPlayback() && !matchMedia('(hover: hover)').matches;
  hush.classList.toggle('hidden', unlocked !== 'blocked' && !mute);
  hush.textContent =
    unlocked === 'blocked'
      ? 'The audio device is there but it is not running. Tap anywhere on the page — and if this is an iPhone, check the ring/silent switch on the side.'
      : 'If you hear nothing: this version of iOS silences web audio with the ring/silent switch on the side of the phone. There is no way for a page to override it.';
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

startAnalytics();

bench.refresh();
floor.refresh();
show(state.room);
writeUrl(state);
