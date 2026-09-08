# Start here

Three steps, then one prompt to paste.

## 1. Put v12 in this folder

Copy `e-threat-response-v12 (1).html` into the root of this project and rename
it `v12-original.html`. That file is now the source of truth — everything gets
extracted from it.

If you have older versions (v11, v10) and any of them felt better to play, drop
them in too as `v11-original.html` and so on. They cost nothing to keep and
they are the only record you have of what changed.

## 2. Install and initialise

```bash
cd threat-response
npm install
git init
git add -A
git commit -m "Scaffold plus untouched v12 source"
```

That commit matters. It is the point you can always get back to, which means
nothing that follows can lose you work.

## 3. Paste this into Claude Code

Open Claude Code in this folder and give it the brief below. It is deliberately
one task — the split, and nothing else. Resist the urge to bundle
"and also add sound" into the same session; a refactor you can verify is worth
more than a refactor plus features you can't attribute blame for.

---

Read `CLAUDE.md`, then read `v12-original.html` in full before changing
anything.

Your task is a pure refactor: take the single-file game and split it into the
structure described in CLAUDE.md, with **zero intended change to behaviour or
appearance**. Do not improve anything yet. Do not fix things you think are
wrong. Note them in `NOTES.md` for later and move on.

Work in this order:

1. **Inventory first.** Before writing any files, tell me what you found: how
   many scenarios, what the scoring model actually is, what the state machine's
   states are, what the canvas background is doing, and anything that surprised
   you. Wait for me to confirm before you start moving code.

2. **Extract content to data.** Pull every scenario into
   `src/data/scenarios.json`. Design the schema from what the real content
   needs — do not invent fields it doesn't use. Then write the schema shape
   into CLAUDE.md so it is documented for whoever writes the next scenario.

3. **Extract the engine.** Move state transitions and scoring into
   `src/engine/`, with no DOM references. Everything in and out through
   arguments and return values.

4. **Split the rest.** Styles into `src/styles/` with tokens first. Canvas and
   effects into `src/render/`. Each screen into its own module in
   `src/screens/`.

5. **Self-host the fonts.** v12 pulls four families from Google Fonts, which
   means it renders in system sans-serif with no network. Download the woff2
   files for the weights actually used into `src/assets/fonts/` and add
   `@font-face` rules. Check whether Space Grotesk is used at all; if not,
   drop it. Report the total added weight.

6. **Write tests for the scoring only.** In `tests/`: every scenario is
   reachable, every path terminates, no defence layer is strictly dominant
   across all scenarios, and the scoring maths matches v12's for a handful of
   known paths you extract by reading the original.

7. **Verify.** `npm run build`, then open `dist/index.html` with your network
   off and play it start to finish. Screenshot every screen at 375px and at
   1280px and compare against the same screens in `v12-original.html`. Report
   any visual difference you find, however small, rather than deciding it
   doesn't matter.

Commit at each step with a message describing what moved. If step 7 shows a
difference you can't explain, stop and tell me instead of patching over it.

---

## After the split

Once the refactor is verified, the things worth doing next — roughly in order
of value for a tool that gets shown to customers:

- **Play it and fix what feels wrong.** This is the whole reason for moving.
  Ask Claude Code to play through every branch and report where pacing sags,
  where a choice feels obvious, or where the outcome doesn't land.
- **Check the game is actually a game.** If one opening layer wins most
  scenarios, there is no decision being simulated. The tests will tell you.
- **Make the takeaway exportable.** A summary of "here is what your choices
  cost you" is the artifact a prospect keeps. Right now nothing leaves the
  screen.
- **Instrument it,** if this is a marketing tool. Which layer people reach for
  first is the single most interesting thing this game knows, and it currently
  throws that away.

## A note on the build

`vite-plugin-singlefile` inlines all JS, CSS and assets into one HTML file, so
`dist/index.html` is a drop-in replacement for v12 — same distribution model,
same "email it to someone" property. You gain the file structure while
developing and lose nothing at delivery.

Fonts are the one thing to watch: inlined as base64 they will add a few hundred
KB. That is the correct trade for a file that must work offline, but subset the
woff2 files to Latin and only the weights in use, or it gets silly.
