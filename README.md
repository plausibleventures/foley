# Foley

**A sound foundry in the browser.** Design a kit of interface sounds that are one family rather than
twenty-four files, build a whole track out of a sequencer and an ambience bed, play your kit over the
top of it, and take any of it away as a real 16-bit WAV. No samples, no uploads, no account, no
server.

Live at **[foley.plausible.ventures](https://foley.plausible.ventures)**. One of the
[Plausible Ventures](https://plausible.ventures).

---

## What it is

Two rooms, one engine.

**The bench.** Twenty-four interface sounds — tap, press, confirm, error, open, close, delete,
arrive — generated from one material and eight axes. No sound stores a frequency: each is written as
intervals over the kit's root, so moving the key moves all twenty-four together and they stay in
tune with each other. Edit any layer by hand and that sound detaches from the generator and says so.
Download one WAV, the whole kit as a zip, or the recipe as TypeScript you can paste into a project.

**The floor.** A sixteen-step sequencer over a four-bar progression with eighteen instruments, a
continuous ambience bed driven by two numbers, your kit on twenty-four keyboard-mapped pads, a mixer
across the three buses, and a live voice roll. Arm a take, play something over the loop, and render
the whole thing — sequencer, bed and every hit you played — to one file.

## What makes it different from the other browser sound tools

The interesting constraint is that everything here runs on
[`@latticekit/audio`](https://www.npmjs.com/package/@latticekit/audio), whose whole design position
is that **a sound is ten numbers, not a node graph**. One fixed chain per layer — source, high-pass,
low-pass, gain envelope, pan — and nothing about the routing is author-defined. No LFOs, no
modulation matrix, no reverb, no delay, no `AnalyserNode`, no audio files anywhere.

That refusal buys three things this project is built around:

1. **The clipping ceiling is provable rather than probable.** Because routing is fixed, the peak of a
   sound can be computed before it plays. `validateSounds` runs on the page against the table you are
   editing, and the generator scales a sound down as a whole if its own worst instant would cross the
   ceiling — so no combination of sliders can produce a table that distorts.
2. **The file cannot drift from the sound.** The WAV is the identical engine and the identical table
   pointed at an `OfflineAudioContext`. There is no second synthesiser to keep in step.
3. **The visualiser is honest.** The roll on the floor is drawn from the engine's own `onScheduled`
   callback — what it *decided*, with the exact times and pitches it decided on — not from an
   analyser reporting one frame late. You can watch the sequencer's second-and-a-half lookahead
   arrive on the right of the now-line.

The other half is the design argument, which is that a kit sounds designed when it is **in one key
and one material**. Everything that means yes rises through a major triad; everything that means no
falls by a minor second or a tritone. Open and close, on and off, send and receive are the same two
notes in the other order. Nobody hears any of that consciously and everybody hears when it is
missing.

## Where the range actually comes from

Not from the sliders. The five materials differ in the one thing no slider can reach: **which
partials are there at all.**

| Material | Partials | Why it sounds like that |
|---|---|---|
| Glass | 2, 3 | Harmonic. The ear fuses them into one pitch. |
| Wood | 2.4, 3.9 | Near-misses of the octave and twelfth — a struck block. |
| Rubber | none | One sine with a downward drift. A thumb on a table. |
| Metal | 2.76, 5.4 | The ratios of a real bell. They belong to no scale, and that inharmonicity is why a bell sounds struck rather than played. |
| Vapour | 2 | A fifty-millisecond attack and a lot of air — past the point where an onset reads as caused by the press. |

Move every slider to its limit on Glass and you will not arrive at Metal. The sliders are how hard
you hit it; the material is what you hit.

## Running it

```bash
npm install
npm run dev        # http://localhost:5196
npm run check      # the gate — see below
npm run build      # typecheck, gate, then vite build
```

### The gate

`npm run check` is what stands between a bad recipe and the deploy. It builds every sound at **all
128 corners of the eight-axis space, against every material, at three keys** — 1,920 tables — and
asserts the engine's own validator returns nothing: no clipping, nothing inaudible, no layer under
the audible floor, no ladder shorter than its own throttle. Peak gain is monotonic in every axis it
varies, so the interior of that hypercube cannot fail if the corners do not.

It also runs every starting pattern through `validateSong`, checks that no bed has a hole between
its crossfade bands at any value of `tone`, checks that no bed sags a low layer under 20 Hz, and
verifies the zip writer's CRC-32 against the standard check value.

`validateSounds` and `validateSong` return problems rather than throwing, on the argument that a
shipped app must not refuse to start because a hat is 0.02 too loud. That is right at runtime and
wrong at build time, which is why the assertion lives here.

## Layout

```
src/
  audio/
    kit.ts          the twenty-four sketches, the five materials, the eight axes, the generator
    instruments.ts  eighteen TrackVoices for the sequencer
    patterns.ts     six starting patterns, in a sixteen-token notation
    beds.ts         seven ambience beds
    live.ts         the one engine the page ever builds, and why the table is edited in place
    offline.ts      the same engine pointed at an OfflineAudioContext
    wav.ts          16-bit PCM, trimmed at both ends
    zip.ts          store-only ZIP, about eighty lines
  ui/
    bench.ts floor.ts roll.ts draw.ts lens.ts dom.ts
  state.ts          everything the page is, and the codec that puts it in the address bar
tools/check.ts      the gate
```

## Two decisions worth knowing about before changing anything

**The live sound table is mutated in place.** `createAudio` takes its recipe table once and the only
way to give it a different one is to build a different engine — which means `dispose()`, which closes
the `AudioContext`, of which a document gets about six. A page whose entire purpose is a slider you
drag while listening cannot rebuild the engine when the table changes. `src/audio/live.ts` builds the
table once with mutable definition objects and edits them; the package documents that this works, as
a warning. It is the only file allowed to do it.

**There is exactly one `Song` object on the floor and it is edited in place too.** The deck reads
`song.tracks` afresh on every pump, so a note toggled in the grid is picked up at the next step with
no restart. Tempo is the exception — `stepSec` is computed once when a song is handed over — so
changing bpm genuinely does restart the loop.

## Licence

Everything you make with it is yours, with no conditions.
