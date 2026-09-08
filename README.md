# N-able Threat Response

A two-minute ransomware decision simulator. One self-contained HTML file that
works with no network, no server and no install.

You are the person on call for a small business that BlackVault is already
inside. Before the attack starts you spend a readiness budget across three
defense layers. Then, across five escalating stages mapped to real MITRE
ATT&CK techniques, you lead with one layer and back it with a second — and
the backup has to be a different pillar, because no single product carries a
stage. The run ends with a Business Resilience Index, the phase you are
weakest in, and whether the business opens the next morning.

Built to teach N-able's Manage / Secure / Recover story at trade stands, on
the website, and as a link a rep can send.

## Quick start

```bash
npm install
npm run dev      # iterate
npm run build    # -> dist/index.html, the deliverable
```

`dist/index.html` is the whole thing. Open it from disk, email it, put it on
a USB stick. There is nothing else to deploy.

## Verify before you ship

```bash
npm test         # engine, scenario integrity, QR round-trip  (47 tests)
npm run verify   # headless playthroughs + layout audit       (needs a build)
npm run balance  # Monte Carlo answer-key and strategy report
```

`npm run verify` is the one that catches what reading the source cannot: it
fails the run on **any** request that is not `file:`, `data:` or `blob:`,
plays the game to completion at four viewports in both timed and learn mode,
checks for horizontal page scroll and undersized tap targets, confirms the
pillar cards are reachable without scrolling on a phone, and confirms
`prefers-reduced-motion` actually suppresses what it claims to. Add `--shots`
to write screenshots to `tests/shots/`.

`npm run balance` answers the question that decides whether the score means
anything: can somebody with no security knowledge reach a high rank? Run it
after every change to `src/data/scenarios.json`.

## What is where

| Path | What it is |
|---|---|
| `src/data/*.json` | All content. Scenarios, clients, readiness cards, the estate, BlackVault's voice. No logic. |
| `src/engine/` | State machine, stage resolution, scoring. No DOM — a whole run plays in Node. |
| `src/screens/` | One module per screen. |
| `src/ui/qr.js` | QR encoder, in-file, because a CDN script would break the offline constraint. |
| `src/config.js` | `VERSION`, the storage key, per-event defaults. |
| `CLAUDE.md` | The constraints, the scenario schema, and why things are the way they are. Read this before changing anything. |
| `NOTES.md` | Open items that need a decision rather than a patch. |

Adding a scenario means editing one JSON file. The schema is documented in
`CLAUDE.md`, and the tests will tell you if the answer key has gone soft.

## Playing it

- **1 / 2 / 3** pick a layer, **S** scan, **H** isolate, **X** answers a
  live inject, **Enter** is the primary action, **R** replays, **M** sound,
  **?** the rules. The whole game is completable without a mouse.
- **Learn mode** removes the clock. The decisions and the answer key are
  identical.
- Runs are seeded. The five-character run code on the result screen replays
  the identical five stages — put it in the URL as `#CODE`. Useful for a
  fair head-to-head at a stand, and for reproducing a bug.

## Per-event configuration

Everything deployment-specific is in one plainly commented block in the
**first kilobyte of `dist/index.html`**, so it can be changed on a tablet at
a stand with a text editor and no rebuild: `eventName`, `kioskId` (tags
leads so two tablets at one stand can be told apart), `prize`, `landingUrl`
(where the scorecard QR points), `metricsEndpoint` (empty means local only,
the right default on venue wifi), `privacyUrl` and `emailFulfillment`.

The same block is in `index.html` in the source, and `src/config.js` holds
the defaults it is merged over. It has to work this way round: read off a
module const, the bundler folds the falsy values away and the keys do not
exist in the built file at all.

Leads and the leaderboard live in `localStorage` per device, and the stats
panel says so on screen. Export to CSV from there.

## Two things that are not true unless you make them true

- `emailFulfillment` is `false` and the confirmation copy says the
  scorecard is saved on the device. Nothing in this codebase sends email. Set
  it `true` only when `metricsEndpoint` actually fulfills one.
- `landingUrl` is the company homepage. The campaign scorecard page
  the QR is meant to reach does not exist yet; the run's result is already
  carried in the query string for when it does.
