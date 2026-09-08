# v14 plan

Written after Phase 0, before any code changed. Baseline screenshots for
comparison are in `docs/shots/v13-baseline/`.

> **Status: Tier 1 shipped.** What actually landed, and where it diverged
> from this plan, is recorded at the bottom under
> [What shipped](#what-shipped). The measurements this plan is built on are
> in `docs/balance/monte-carlo-v13.txt`; the same harness against the
> shipped build is `docs/balance/monte-carlo-v14.txt`. Nothing in this file
> above that section has been edited after the fact.

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

## What shipped

Appended after Tier 1 landed. Everything here is checkable: the Monte Carlo
reports are in `docs/balance/`, the screenshots in `docs/shots/v14/` and
`docs/shots/v14-dark/`, and `npm test && npm run balance && npm run
contrast && npm run verify` reproduces all of it.

### Tier 1, item by item

| # | item | outcome |
|---|---|---|
| 1 | tokens.css as a real layer | done — 128 bypasses → 0, two annotated `/* token-fallback */` restatements left in the QR encoder for the Node case |
| 2 | light default, dark behind `data-theme` | done — both themes shot at four widths from one stylesheet |
| 3 | light signal set ≥4.5:1 | done — worst text pair 4.81:1 light, 4.91:1 dark |
| 4 | contrast audit failing the build | done — 574 pairs across 4 scopes × 6 stage states |
| 5 | escalation without luminance | done — surface drift plus a separate `--stage-tint` layer |
| 6 | scanlines out, vignette and particles re-cut | done — particle count sized by a measured 6ms frame budget |
| 7 | the climax inverts to `#140628` | done — `lights-out` clip-path wipe, suppressed under reduced motion |
| 8 | result screen re-cut, dial strongest visual | done — dial is a banded instrument, gap promoted above the rank |
| 9 | rewrite all 60 `act` strings | done — longest-action heuristic 85% → 30%, and the regression test checks both length extremes rather than just the top one |
| 10 | rebalance the readiness board | done, but **not as planned** — see below |
| 11 | injects never fire into a pending pick, never steal focus | done — and found the reason no inject had ever rendered in a browser |
| 12 | seed entry and a copyable run link | done |
| 13 | gap promoted above the rank | done |
| 14 | `act` copy pass | done, folded into 9 |
| 15 | 40,000-run Monte Carlo, before/after | done — `docs/balance/` |
| 16 | shots, offline, reduced motion, keyboard-only, size | done — and the keyboard run found two real bugs |

### Where it diverged

**Item 10 took three passes rather than one, and the plan's prescription
was wrong.** The plan proposed making `asset-inventory` discount a scan's
ground cost and leaving the scan itself alone. Measuring that found the
larger problem: the scan revealed the *weakest* layer, which eliminates
the only pick that breaches and is therefore worth 1.5 defense points a
stage against 1.0 for a coin flip — Threat Hunter 74% of the time for a
player who knows no security and pressed one button. Revealing the
*partial* layer instead is worth exactly nothing to that player and a
great deal to one who can reason about the technique. That is the change
the plan should have called for.

The second thing measurement contradicted: **ground is nearly inert.** A
player who decides in four seconds on a thirteen-second clock is never
timed out, so intrusion depth moves speed points and nothing that touches
the rank. Three of six readiness cards bought ground, which is why they
all measured under +0.5 index — including the two the plan proposed
fixing by giving them *more* ground. Each card now acts where the
consequence lands, on a different failure mode from the others.

**Two more things the plan asserted and Phase 0 got wrong.** "375px,
reduced motion, offline, tap targets: all clean — the older
`min-width:auto` flex bug is closed" was true only of the check that
existed. The page-level overflow check cannot see content clipped inside
a panel with `overflow: hidden`, and the sentence booth staff read out
loud was truncated mid-word at 375px. And "the whole game completable
without a mouse" was in the quality floor, unmeasured, and false: a
keyboard player could not buy a readiness card.

### Tier 2, still not built

Unchanged from the list above. Nothing moved up; the audio re-cut is now
worth revisiting because the visual work has landed and can be heard
against.

### Numbers

Both columns are the same harness at 40,000 runs, quoted from
`docs/balance/monte-carlo-v13.txt` and `docs/balance/monte-carlo-v14.txt`
so every figure here can be checked against the file it came from. The v13
column needed three one-line shims to read `revealed.weak` instead of
`revealed.partial`; nothing else about the harness differs between them.

Two units appear below. **Defense points** (0–10) are what the rank ladder
reads and they do not amplify variance. **Hunter+** is the share of runs
reaching Threat Hunter or better, which is a count of runs crossing a line,
so it responds to variance as well as to the mean. Where a claim is about
expected value, the defense-point figure is the one to read.

### The three exploits

| | v13 | v14 |
|---|---|---|
| "pick the longest action" vs blind | **+79.8** Hunter+ | −5.1 |
| "pick the one with a comma" vs blind | **+52.7** Hunter+ | +0.5 |
| press S, then guess | **+1.77 defense points** (+30.0 Hunter+) | −0.08 (−0.9) |

The scan row is the sharpest number in the comparison. +1.77 defense points
out of 10 is an 18% swing on the metric the rank ladder reads, bought by
pressing one button with no security knowledge at all.

### The rest

| | v13 | v14 |
|---|---|---|
| blind reaches Threat Hunter | 20.2% | **37.7%** (band 35–45) |
| blind defense points | 4.7 | 4.7 |
| best single pillar, defense points over blind | +0.54 | +0.53 |
| best single pillar, Hunter+ over blind | +6.4 | +8.3 |
| semi-informed, defense points over blind | +1.0 | +1.0 |
| semi-informed, Hunter+ over blind | +17.6 | **+20.3** |
| strongest two-card build, Champion | 0.8% | 0.8% |
| readiness cards that are live choices | 3 of 6 | **6 of 6** |
| harness checks passing | 11 of 17 | **17 of 17** |
| colour literals outside tokens.css | 128 | **0** |
| built file | 222,273 B | 241,676 B (+8.7%) |

Read the defense-point rows and the pool is almost unchanged: blind play is
worth 4.7 points in both versions, the best single pillar is worth +0.53 over
it in both, and a semi-informed player is worth +1.0 over it in both. **That
is the honest statement of what happened to the answer key: the exploits
went, and nothing else about the pool's difficulty moved.**

What moved is where the Threat Hunter line sits — 6 defense points rather
than 7 — and that is why blind play goes from 20.2% to 37.7%, into the 35–45%
band the brief asked for. It is also why the same +1.0 defense points that
knowledge buys converts into 20.3 points of Hunter+ rather than 17.6: the
defense-point distribution is densest between 4 and 6, so a line at 6 sits
where an advantage actually shows. The ladder is a more sensitive instrument
now, reading the same pool.

The same effect explains the single-pillar row, which is the one that looks
like a regression and is not: +6.4 → +8.3 Hunter+ on an unchanged +0.53
defense points. Both reports show "always Secure" scoring 5.2 defense points
and picking 34.6 / 40.7 / 24.8 in v13 against 34.9 / 40.2 / 24.8 in v14 — the
same strategy, the same pool, a more sensitive ruler. It is also why the
check on it is measured in defense points now, with the ladder reading kept
one-sided beside it; the Hunter+ version straddled its threshold across
repeated runs at +7.8 to +10.5 while the pool never moved at all.

The underlying pool property is worth naming though, because it is the one
thing in the answer key I would still want a second opinion on: **Secure is
the weakest layer in only 5 of the 20 variants** rather than the 6.7 a flat
pool would give, so "always lead with detection" avoids the pick that
breaches more often than chance. Computed exactly rather than sampled, that
is worth +0.50 defense points a run against a coin flip — Manage is +0.25,
Recover is −0.75 — and `tests/integrity.test.js` now bounds all three at one
point per run, a fifth of what the pool pays for actually knowing the answer.
It is inside every bound, and it is arguably true to life. But it is the
reason one pillar reads +8.3 on the ladder, and if a future content pass adds
variants it is the number to watch.
