# v14 plan

Written after Phase 0, before any code changed. Baseline screenshots for
comparison are in `docs/shots/v13-baseline/`.

## Corrections to the brief

Three things in the v14 brief do not match the repo. Flagging them because
two of them would send work in the wrong direction.

1. **`src/content/` does not exist. The content lives in `src/data/`.**
   Five files: `scenarios.json`, `clients.json`, `foe.json`,
   `postures.json`, `estate.json`, each with its own `_schema` block.
2. **Root `index.html` is the Vite source entry, not a build artifact.**
   The artifact is `dist/index.html` (gitignored). Root `index.html` holds
   the `<script>window.TR_CONFIG</script>` block and the effect-layer
   shell, and it *must* be hand-edited — it is the only place per-event
   settings can be changed without a rebuild. "Never hand-patch the built
   file" is right; "index.html at root is a build artifact" is not.
3. **Lead records already emit `v: VERSION`.** `VERSION` is `'v13'` and
   every emission path (leads, completions, abandons, CSV, QR, leaderboard)
   reads it. The only `'v8'` string in `src/` is inside a comment
   describing the historical bug. Nothing to fix; bumping to `'v14'` is the
   whole change.

## What Phase 0 found

### The token layer is not a token layer

`tokens.css` declares 38 custom properties, 27 of them colors. Across the
rest of `src/`, **128 further color decisions bypass it**:

| file | bypasses |
|---|---|
| `styles/stage.css` | 49 |
| `styles/screens.css` | 27 |
| `styles/base.css` | 20 |
| `styles/result.css` | 18 |
| `styles/hud.css` | 11 |
| `ui/qr.js` | 2 (hardcoded `#0C0820` / `#EDE9FB`) |
| `render/canvas.js` | 1 rgba + **4 RGB triples in a JS object** |

The tractable part: **86 of the 128 are alpha variants of a colour that is
already a token** — `rgba(255,77,103,.45)` is `--red` at 45%. Those convert
mechanically. The canvas `MOODS` map holds `--brand`, `--amber`, `--red`
and `--green` as raw `{r,g,b}` triples, so the particle field cannot follow
a theme at all. Two near-black scrim values trace to nothing.

So the re-theme is not a find-and-replace, and it was never going to be:
editing `tokens.css` today changes roughly a fifth of the visible colour.

### The answer key has a typographic tell — worse than a positional one

I measured the `act` strings, which are the copy a player reads at the
moment of choosing:

| rank | mean length | mean commas |
|---|---|---|
| `best` | 61.0 chars | **1.00** |
| `partial` | 52.5 chars | **0.00** |
| `weak` | 49.9 chars | **0.00** |

- **"Pick the longest action" is correct on 17 of 20 variants — 85%,
  against a 33% baseline.**
- Every single `best` action contains a comma. No `partial` or `weak`
  action contains one. On the 10 variants where exactly one card has a
  comma, **"pick the card with a comma" is correct 10 times out of 10.**

This is my bug from v13: I wrote the correct answer as a compound order
("Kill the transfer, scope exactly what left, cut the channel") because it
sounded more decisive, and in doing so I made the answer key readable
without reading it. A security professional would not spot this. Anyone who
plays three times would. It is the same credibility failure as v9's
positional pattern, arriving through the copy instead of the ranks.

### The readiness board is broken in two directions at once

3,000 timed runs per configuration, played by an attentive non-expert who
scans when it can afford to and uses whatever the scan revealed:

| card | Δ index alone | verdict |
|---|---|---|
| `soc-watch` | **+16.7** | strongest single point |
| `patch-cadence` | +12.5 | strong |
| `asset-inventory` | +9.5 | strong |
| `auto-isolate` | +8.7 | strong |
| `restore-drill` | **+0.6** | dead |
| `immutable-vault` | **+0.3** | dead |

And the combination that matters:

> **`asset-inventory` + `soc-watch` → index 96.6, Threat Hunter+ 100.0%,
> 3.7 of 5 contained.**

Two of three budget points, one Manage and one Secure so the per-pillar cap
allows it, and the run is solved. `soc-watch` makes a scan free every
stage; `asset-inventory` makes a scan reveal the *best* layer as well as
the weakest. Together they read the answer key aloud, five times, to a
player who knows nothing. That is a total break, and it is a worse one than
the copy tell because it is a build a player would arrive at on purpose.

The second direction is the one that actually matters commercially: **both
dead cards are the Recover cards.** The readiness board exists to make
"resilience is layered and built before the attack" playable. As shipped it
teaches *buy monitoring, skip backup* — the same lesson v9 got fired for.

Root causes, separately:
- `asset-inventory` reveals the correct answer. Any card that does that is
  a card that deletes the game. Mine to fix by changing what it does.
- `immutable-vault` only pays if a stage-4-or-5 scenario targets `backups`
  *and* the player breaches it. Rare, so it measures as noise.
- `restore-drill` only fires on a perfect stack, and only if there is
  damage to repair. Rarer still.

### Smaller things, confirmed not assumed

- **Injects fire inside the pick window.** They trigger at intrusion depth
  45–62; a timed player commits a lead at roughly depth 40–55. The overlay
  then calls `act.focus()`, taking keyboard focus off the pillar cards
  mid-decision, and `Space`/`Enter` get captured by the inject handler. So
  the interrupt can arrive as a focus theft during the decision it is
  supposed to interrupt.
- **The seed is never enterable.** `decodeSeed` is wired to the URL hash
  only. There is no field anywhere, so "play the run your colleague played"
  requires knowing to hand-edit a URL fragment. The strongest booth and
  social mechanic in the build is invisible.
- **Estate `loss` strings do render** — in the estate cell's accessible
  name and on the result screen. That one was fine.
- **375px, reduced motion, offline, tap targets: all clean.** The v13
  harness reports 0 problems at four viewports, so the older
  `min-width:auto` flex bug is closed. Verified, not assumed.

## Tier 1 — doing it

**Theme foundation**
1. Rebuild `tokens.css` as a real layer: three brand anchors at the top
   marked as the swap point, semantic tokens beneath, and an alpha
   mechanism so the 86 rgba-of-a-token literals become
   `color-mix(… var(--token) N% …)`. Route the canvas, the QR encoder and
   the two scrims through it. Target: zero meaningful bypasses.
2. Light theme as default, dark preserved behind `[data-theme="dark"]`.
   The dark theme is the proof the token layer is honest.
3. Light-mode signal set at ≥4.5:1, with the current bright values kept as
   `--tone-glow` for fills, halos and particles.
4. `scripts/contrast-audit.mjs`, failing on violation, including
   text-on-fill pairs.

**Escalation without luminance**
5. Per-stage surface drift: cool neutral at stage 1 → warm desaturated at
   stage 5, accents gaining chroma, borders hardening, radii tightening,
   shadows deepening. Readable from a blurred thumbnail.
6. Scanlines out, fine dot grid in. Vignette tints inward with light-mode
   red instead of darkening. Particles inverted to dark-on-light, threat
   state gaining density and speed rather than brightness, count capped by
   measured frame time.
7. **The climax inverts to `#140628` full-screen.** Going dark once, at the
   moment the business is about to close, is the single best thing the light
   theme buys and it gets designed as the set piece it is.
8. Result screen re-cut as a print-legible sales artifact, dial as the
   strongest single visual.

**The game**
9. **Rewrite all 60 `act` strings** so neither length nor punctuation
   carries signal. Add a test that fails the build if the
   longest-action heuristic beats 45%, or if comma counts differ by rank.
10. **Rebalance the readiness board.** `asset-inventory` stops revealing
    the answer and instead makes a scan cost no ground; `immutable-vault`
    prevents closure outright (backups intact means the business does not
    close, which is exactly what immutable backups buy); `restore-drill`
    fires on any contained stage rather than only a perfect stack. Then
    re-measure all six until every card is a live choice and no pair
    solves the run.
11. Injects never fire while a pick is pending, and never steal focus from
    the cards.
12. Seed entry on the attract screen, plus a copyable run link on the
    result screen.
13. Gap diagnosis promoted to the top of the result screen, above the rank.
14. `act` copy pass for the weak ones found while rewriting for 9.

**Validation**
15. `scripts/monte-carlo.mjs` at 40,000 runs: rank distribution, stages
    contained, per-pillar and per-stage-position correctness spread,
    posture pick-rate and card marginal value, plus the two heuristic
    exploit checks. Before/after against v13.
16. `scripts/shots.mjs` at 375/768/1024/1440 into `docs/shots/v14/`, zero
    external requests, no horizontal overflow, reduced-motion run,
    keyboard-only run. Built size vs v13, flagged over +15%.

## Tier 2 — proposing, not building

- **Shield-a-system on the estate map.** Let the player commit protection
  to one of six systems each stage, so the board becomes a thing you act on
  rather than a readout. It is the biggest single upgrade available to the
  stage screen, and it is also a third decision per stage in a two-minute
  run. I would want to remove the `hold` action to pay for it, and that is
  a bigger rebalance than v14 should carry.
- **Difficulty tiers.** A "practitioner" mode with 4 variants visible and
  no scan. Cheap to build, but it splits the leaderboard and the score
  stops being one comparable number.
- **BlackVault reacting to your posture.** Have the taunts reference what
  you did or did not buy ("you have no vault; this is administrative").
  Strong writing opportunity, needs the foe pool restructured per-posture,
  and risks turning a dry antagonist into a commentator.
- **Case files.** Unlock a short real-incident note after the technique
  that beat you. Genuinely educational and a reason to replay; it is also a
  new screen and new content to maintain.
- **Audio re-cut for the light theme.** The synth bed was designed against
  a dark, tense surface. It probably wants to be sparser now. Speculative
  until the visual work lands and I can hear it.

## Cut — explicitly not doing, with the reason

- **Persisted dark-theme toggle in the settings sheet.** The brief lists it
  as a follow-up and I agree with that ordering. v14 ships the
  `data-theme` attribute, a URL override and a key, so the mechanism is
  proven; the settings UI and persistence come after.
- **Touching the scoring formula.** The BRI weighting, the defense-point
  ladder and `resolveZone`'s consistency guard are the three things in this
  codebase with the longest history of getting it wrong. The posture and
  copy fixes are enough change to the answer key for one version.
- **Any new currency, cost or time-to-recover figure.** Every one would be
  invented. The constraint holds.
- **Re-theming the QR code's own modules to brand violet.** Scanners want
  maximum contrast and a booth tablet at an angle in expo lighting needs
  every point of it. Ink-on-paper stays.
- **Merging the v9-phone branch.** It is not in this repo and the v13
  harness reports the mobile debt closed. Listed as a follow-up; I would
  need the branch to say anything true about it.
