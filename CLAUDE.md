# N-able Threat Response

A two-minute ransomware decision simulator. The player spends a readiness
budget before the attack, then leads with one defense layer and backs it with
a second at each of five stages, and sees what the combination costs the
business.

## The hard constraint

**Every build must produce one self-contained `.html` file that works when
opened directly from disk, with no network access.**

This is not negotiable and it shapes everything below. The game gets emailed
around, run from a USB stick at events, and opened on locked-down customer
machines. If it needs a web server or an internet connection, it is broken.

Concretely:
- No external font, script, or stylesheet URLs in the built output.
- No `fetch()` of local files — scenario data is imported at build time so it
  gets inlined, not requested at runtime.
- Relative asset paths only (`base: './'` in the Vite config).
- Verify with `npm run verify`, which fails the run on any request that is not
  `file:`, `data:` or `blob:`. Not by trusting the dev server.

Current built size: **~236 KB**, of which 45 KB is subsetted woff2.

## Commands

```bash
npm run dev              # dev server with hot reload
npm run build            # single-file output to dist/index.html
npm test                 # engine, scenario integrity and QR round-trip
npm run verify           # headless playthroughs, layout audit, offline check
npm run verify -- --shots   # ...and write screenshots to tests/shots/
npm run balance          # Monte Carlo answer-key and strategy report
npm run contrast         # WCAG audit of the token layer, fails on violation
npm run shots <dir>      # every screen state at four widths, --theme dark
```

Run `npm run balance` after **any** change to `src/data/scenarios.json`,
`postures.json`, the ranks, the scoring or the injects. It prints seventeen
checks and exits non-zero on any of them. A drift of a few points is noise; a
strategy moving ten points means the answer key changed shape.

Run `npm run contrast` after any change to `src/styles/tokens.css`, and
`npm run verify` before saying a change works — the browser is the only thing
that can tell you whether the layout holds, whether anything left the file,
and whether the keyboard still gets through the game.

The two reference reports live in `docs/balance/`: `monte-carlo-v13.txt` is
the baseline the v14 work was measured against, `monte-carlo-v14.txt` is the
shipped build. Regenerate the second one rather than editing it.

## Structure

```
src/
  main.js               entry — wires engine to screens, owns no rules
  config.js             VERSION, storage key, per-event defaults
  data/*.json           all content, no logic
  engine/               state machine, resolution, scoring — no DOM
  render/               canvas field, screen effects, synthesized audio
  ui/                   DOM helper, board components, icons, QR encoder
  screens/              one module per screen
  styles/               tokens.css first, then base/hud/stage/screens/result
  assets/fonts/         self-hosted woff2
scripts/                monte-carlo.mjs, contrast-audit.mjs, shots.mjs
tests/                  vitest (engine, integrity, QR) plus browser.mjs
docs/balance/           the reference Monte Carlo and contrast reports
docs/shots/             screenshot sets, one directory per version+theme
```

Three rules that matter more than the rest of the layout:

**`engine/` must not touch the DOM.** State transitions, resolution and
scoring take inputs and return outputs. That is what lets a whole run be
played in Node with no browser, which is how the answer key gets validated —
and the answer key is the part most worth testing, because if one defense
layer is quietly dominant the game has no tension and no teaching value.

**`data/*.json` must contain no logic.** The point of separating it is that
someone on the security team can write a new scenario without reading any
JavaScript. If a scenario needs a code change to work, the schema is wrong —
fix the schema.

**`main.js` owns no rules.** Anything in it that looks like a game rule
belongs in `engine/`.

## The commercial argument the mechanics have to carry

This outranks any improvement idea.

> Resilience is layered, and it is built before the attack — not bolted on
> during it.

Three consequences, each enforced by a rule rather than asserted in copy:

1. **You cannot win with one product.** The backup pick must be a different
   pillar from the lead (`choose()` returns early if they match), and the
   readiness board caps spend at two points per pillar against a budget of
   three. A single-product build is not expressible.
2. **Recovery is not a stage-five rescue.** Recover is the correct lead in
   exactly one of the four stage-five variants, and it is correct at every
   other stage position too. A test asserts both.
3. **The answer key must require real security knowledge.** Every pillar can
   be correct at every stage position. `npm run balance` measures whether a
   blind or positional player can beat it, and it measures the two things
   that turn out to be much easier to break than the ranks:

   - **The copy.** v13's `best` actions averaged 61 characters with exactly
     one comma each; `partial` and `weak` averaged 51 with none. "Pick the
     longest" was right 85% of the time and beat blind play by 79 points.
     Four tests in `tests/integrity.test.js` now hold length, punctuation and
     both length *extremes* flat across the ranks. Which extreme matters is
     the subtle part: what a heuristic needs is not the answer that is
     correct, it is the answer that is safe, so "the longest is never the
     weak one" is as much of a tell as "the longest is the best one".
   - **The scan.** It reveals which layer is a **partial** fit, never the
     weakest and never the strongest. Revealing the weakest eliminates the
     only pick that breaches, which is worth 1.5 defense points a stage
     against 1.0 for a coin flip — measured at Threat Hunter 74% for a player
     who knows nothing and pressed one button. Revealing the partial is worth
     exactly nothing to that player, by arithmetic rather than by tuning
     (avoid it: 0.5 × 2 + 0.5 × 0 = 1.0; take it: 1.0), and a great deal to
     someone who can reason about the technique. Two checks in the report
     hold it there.

   The consequence to keep in mind: **anything that hands over information is
   knowledge-gated by design, so a knowledge-free player model cannot measure
   it.** The report therefore measures the readiness board twice, against a
   player who knows nothing and against one who can tell the best of two
   layers from the worst. A card that is live for either is a live choice; a
   card dead for both is decoration. Reporting a knowledge-gated card as dead
   is the single mistake this project has made most often — four times, on
   four different mechanics.

Two more that are easy to erode:

4. **No invented statistics, ever.** Real ATT&CK technique IDs and real tactic
   names only. There is deliberately no currency figure, no "average cost of
   downtime", and no countdown with a ransom amount on it anywhere in the
   game. The consequence is carried by the client's own words.
5. **The consequence is emotional, not numerical.** "Harbour Dental closed
   after 32 years" does more work than any score. Protect that beat.

## The pillars

| Pillar | Product | Capability shown in-game |
|---|---|---|
| Manage | N-central | Configuration, patching, inventory — acts on everything, on a cycle |
| Secure | Adlumin MDR | Detection and response — acts on what is happening now |
| Recover | Cove Backup | Immutable copies and tested restores — only works if set up first |

## The readiness board

Six cards, three budget points, two per pillar. Each one acts on a different
axis, and that is a rule rather than a coincidence: three of the six used to
buy **ground**, and ground is nearly inert. A player who decides in four
seconds on a thirteen-second clock is never timed out, so intrusion depth
moves speed points and nothing that touches the rank. All three measured
under +0.5 index and the board was three real choices wide.

| Card | Pillar | Axis it acts on |
|---|---|---|
| Enforced patch window | Manage | how much a breach costs — one point of damage instead of two |
| Complete asset inventory | Manage | how often a near-miss costs anything — a mitigated stage costs nothing |
| 24/7 monitored response | Secure | information (free reads) and time before you commit |
| Automated host isolation | Secure | outcome — the first breach becomes a mitigation |
| Immutable off-site vault | Recover | the narrative — the vault never falls, the business never closes |
| Tested restore runbook | Recover | recovery — any stage that was not a breach brings a system fully back |

When you change a card, ask which of those axes it lands on, and whether
another card is already there. Then run `npm run balance`, which reports
five axes per card (index, defense points, systems lost, total estate health
out of 12, and closure rate) against both player models. Estate health is
there because a card that stops a system being *degraded* is on screen for
the whole run and completely invisible to a count of systems at zero.

**The commercial trap to avoid:** if the Recover cards measure dead, the board
is teaching "buy monitoring, skip backup", which is the exact inverse of the
argument the asset exists to make. That has happened twice. It is worse than
a balance problem.

## Scenario schema

`src/data/scenarios.json` is five stages of four variants, so one run draws
4⁵ = 1,024 unique combinations. A variant:

```json
{
  "tech":   "T1190",
  "ta":     "Initial Access",
  "name":   "Exploit Public-Facing Application",
  "desc":   "Two sentences. The situation, concrete over dramatic.",
  "target": "identity",
  "rank":   { "manage": "best", "secure": "partial", "recover": "weak" },
  "act":    { "manage": "…", "secure": "…", "recover": "…" },
  "fb":     { "manage": "…", "secure": "…", "recover": "…" },
  "inject": {
    "after": 2.4, "seconds": 5,
    "label":  "Appliance is dialing out to an unknown host",
    "action": "Sever the tunnel",
    "ok":     "What happens if they hit it.",
    "miss":   "What happens if they do not."
  }
}
```

- `tech` — a real MITRE ATT&CK technique ID. Never invent one.
- `ta` — the real ATT&CK tactic name for that technique, verbatim. "Defense
  Evasion" is an official tactic name and is spelled that way even though all
  other copy is US English; it is not a spelling to correct.
- `target` — which estate system this attack reaches for. Must match an `id`
  in `estate.json`.
- `rank` — **exactly one** `best`, one `partial`, one `weak`. Tests enforce
  this. The correct backup is derived: the stronger of the two pillars you did
  not lead with.
- `act` — what that pillar's card offers to *do*, written as an order. Not a
  product name and not a benefit statement.
- `fb` — why the choice landed as it did. Explains the reasoning; never just
  right or wrong. This is where the teaching happens, so it is the field worth
  spending the most time on.
- `inject` — optional. A live inject firing `after` seconds into the stage,
  answerable for `seconds`. Timed on the stage clock rather than on intrusion
  depth, because the five stages run on different clocks and the same depth
  number is a different moment in each of them — depth 45 is nine seconds into
  stage one and under three into stage five. Keep `after` under 3 so the inject
  lands in its own beat rather than on top of the lead decision, and keep them
  rare: they exist to break the pick-pick rhythm, and one per stage would
  become the rhythm.

Adding a variant means checking two things beyond the tests: that the pillar
you marked `best` is genuinely the strongest play a practitioner would make,
and that `npm run balance` has not moved.

The other content files (`clients.json`, `foe.json`, `postures.json`,
`estate.json`) each carry a `_schema` block documenting their own fields.

## Scoring

Three separate numbers that measure different things. Keeping them separate is
what stopped v9's contradiction, where "Major breach" could print beside
"Resilient" on the same screen.

**Business Resilience Index, 3–100.** The diagnostic.

```
before = mean(stage 1, stage 2)
during = mean(stage 3, stage 4)
after  = stage 5

index  = round( mean(before, during, after) × 0.6
              + min(before, during, after)  × 0.4 )
         + 6 if stage 5 was contained
```

The 0.4 on the weakest phase is the layered-defense argument expressed as
arithmetic: a chain fails at its weakest link. Both ends are reachable — five
perfect stacks is 100, five breaches is 3.

**Defense points, 0–10.** Drives the rank ladder. Contained 2, mitigated 1,
minus 1 per two systems lost permanently. Five contained stages with an intact
estate is exactly the cap, so Resilience Champion is reachable and rare.

**Score.** The leaderboard number, and the only place speed and reflexes
count. A booth competition must never reward being fast over being right.

`resolveZone()` is the guard: the estate can cap the zone the index earned,
and when it caps it, the result screen says why out loud.

## Visual identity

Light by default. A cool near-white surface, N-able heliotrope as the accent,
deep violet as the ink — it reads as an instrument panel in daylight rather
than a SOC console at 3am, which is what an expo floor, a website embed and a
screenshot in a deck all need. The dark theme is still there behind
`[data-theme="dark"]` and is the proof the token layer is honest: one
stylesheet serves both and neither has a rule of its own.

**Three brand anchors sit at the top of `tokens.css` and everything else is
derived from them.** They are the swap point, and they are marked as such in
the file:

| Anchor | Hex | Role |
|---|---|---|
| surface | `#F4F6FE` | the ground everything else is measured against |
| brand | `#C046FF` | heliotrope, the accent — 3.5:1, so fills only |
| ink | `#140628` | deep violet, the dark theme's ground and the climax |

Note: official N-able brand hex codes are still a pre-launch confirmation item
and have not been formally signed off. Changing them means editing three
values and re-running `npm run contrast`.

### The mechanism, and the one thing that will catch you

Every colour is declared twice: once as an unwrapped RGB channel triple
(`--red-rgb: 176 0 32`) and once resolved (`--red: rgb(var(--red-rgb))`).
Anything needing partial alpha writes `rgb(var(--red-rgb) / 12%)` rather than
inventing an `rgba()`. That syntax is Chrome 65 / Safari 12.1; `color-mix()`
would have been cleaner and is Chrome 111, which is not a bet worth making on
a file whose whole purpose is running on a locked-down machine.

**The gotcha:** `--red: rgb(var(--red-rgb))` is computed on `:root` and
inherits as a finished string. A descendant scope that redefines the theme —
`.on-ink`, the climax subtree — must set **both** the triple and the resolved
token, or the triple changes and every use of `--red` keeps the old value.
`npm run contrast` checks for exactly this and names the tokens that are set
one way and not the other.

The variant suffixes carry a contract, and it is not the v13 one:

| Variant | Means | Rule |
|---|---|---|
| `--x` | border, fill, stroke | ≥3:1 on the ground |
| `--x-b` | emphasis | ≥4.5:1 — **the only variant allowed to carry text** |
| `--x-deep` | subtle fill behind text | never text itself |
| `--x-glow` | energy: halos, particles, sparks | bright in both themes, never text |

Signals, light theme: green `#0D7C5A`, amber `#8A5300`, red `#B00020`, blue
`#1D4ED8`, brand-as-text `#7A1FB8`. `--line2` is a decorative hairline and is
*not* held to 3:1; `--edge` is the boundary of a control with no other visual
anchor and is; `--focus` is the ring. WCAG 1.4.11 applies to the second two.

Radii: `--r: 16px`, `--r-sm: 11px`, both tightening as the stages escalate.
Pillar tones are applied with `.t-blue` / `.t-violet` / `.t-green`, which set
`--tone`, `--tone-rgb`, `--tone-b`, `--tone-deep` and `--tone-glow` together,
so a card, a chip and a map marker for the same pillar cannot drift apart.

### Escalation

`data-stage="1".."5"` on the root element drifts the surface warm, hardens the
borders, tightens the radii, deepens the shadows and raises a `--stage-tint`
layer. **Escalation is carried by chroma and warmth, not by luminance** — a
light theme that gets darker as it goes wrong just looks broken. The test is
whether you can tell the stage from a blurred thumbnail; if you cannot, the
drift is too weak.

Everything that carries escalation resets through one function, `calmDown()`
in `main.js`. There are four channels — the attribute, the vignette, the
particle field and the audio drone — and three of them are driven from the
stage loop frame by frame, so stopping the loop leaves them holding the last
frame. The result screen is the one that must be at rest whatever the run did,
because it is the screen that ends up in a deck.

Type — three families, self-hosted:
- **Chakra Petch** (600, 700) — HUD, headings, anything that should read as
  instrumentation
- **Inter** (variable 400–700) — body copy and UI
- **JetBrains Mono** (variable 500–700) — numbers, timers, telemetry,
  technique IDs

Space Grotesk was in v12 and is gone. Four families for one page was one too
many and it was only doing what Chakra Petch already does.

## Motion

The effects are the game's main feedback channel. Two things to hold to:

- Motion answers a player action or signals a state change. Ambient animation
  on idle elements adds noise, not tension.
- Respect `prefers-reduced-motion`. It suppresses the particle canvas, the
  dot grid, screen shake, the flash, sparks, the delta-chip stagger, the
  climax wipe and the climax countdown. It keeps color state, the intrusion
  track's position and the estate map, because suppressing those would remove
  information rather than motion. `npm run verify` checks this.
- The particle field's count is sized by a measured frame budget (6ms), not by
  a guessed constant, and it reads its palette from the token layer at
  runtime so it can follow a theme change. On the light ground it renders dark
  marks at low alpha and expresses threat as **density and drift speed**, not
  brightness: bright marks on near-white are invisible and turning them up
  makes them more so.

## Quality floor

- Works down to 375px wide, and the three pillar cards are reachable without
  scrolling at 375×667 — the intrusion track advances while a player scrolls,
  so that is a gameplay requirement, not a cosmetic one.
- Visible keyboard focus, and the whole game completable without a mouse.
  `npm run verify` plays a full expert run with no `click()` in it at all, and
  asserts it scores 100. That check exists because the claim was in this file,
  unmeasured, and false: the global Enter handler clicked the screen's primary
  button regardless of what had focus, so a keyboard player on the readiness
  board bought nothing and began the attack; and `mount()` set `tabindex="-1"`
  on its autofocus target, which is right for a heading and takes a button
  out of the tab order permanently. Both were invisible to a manual pass,
  because programmatic focus works either way and Space activates a button.
- No content clipped inside a panel. Page-level horizontal overflow is the
  easy half; the half that bites is a flex item's `min-width: auto` pushing a
  sentence off the end of a card with `overflow: hidden` on it, where the page
  never scrolls and nothing notices. `npm run shots` walks for it and exempts
  `text-overflow: ellipsis`, because visible truncation is a decision.
- Touch targets 44px minimum. Two documented exceptions: an inline link inside
  running text, and a checkbox whose own label is the hit area.
- Color is never the only carrier of meaning — every estate state has a word
  on screen and a sentence in its accessible name.

## Writing

Copy is in the voice of a security console, not a person. States what happened
and what it cost. No apologizing, no exclamation marks, no congratulating the
player on a correct answer — the outcome is the feedback. Sentence case
throughout. Avoid all-caps labels except in the HUD and on chips, where they
are part of the instrumentation look.

BlackVault is menacing but dry. A crew that does this for a living and finds
the defender's effort mildly interesting. Never comic.

**US English throughout**, with one exception: ATT&CK tactic names and
technique IDs are reproduced verbatim, which is why "Defense Evasion" is
spelled that way and must not be "corrected".

## Versioning and storage

`VERSION` in `src/config.js` is the single source of truth and is emitted
everywhere a version string leaves the game: leads, completions, abandons, the
CSV export and the QR payload. v11 and v12 shipped two different strings from
two different code paths, which made funnel analysis unreliable.

`STORE_KEY` is `nable_tr_v8` and **does not move with `VERSION`.** Bumping it
orphans every leaderboard entry and captured lead already sitting on an event
tablet, and there is no migration path off a device you do not have in your
hand. If it ever has to change, write a migration that reads the old key
first, and do it between events.

## Conventions

- Vanilla JS, ES modules, no framework. It is a linear state machine and does
  not need one.
- Plain CSS with custom properties. No preprocessor, no Tailwind.
- No dependency added without a reason that survives being asked twice — every
  one is bytes in a file that has to work offline. The three dev dependencies
  are Vite (bundling to one file), Vitest (engine tests) and Playwright (the
  only way to check that no request leaves the file and that the layout holds
  at 375px).
- Patch, do not rewrite. When editing by script, assert the match count before
  every replacement and never use a regex on a large file — a silently failed
  patch is expensive to find.

## Automation hooks

`window.TR` is exposed for headless playthroughs: `S` (live state), `game`,
`choose(key)`, `scan()`, `hold()`, `rightBackupFor(variant, lead)`,
`startGame()`, `briefGo()`, `beginAttack()`, `advance()`, `summary()`,
`report()`, `openStats()`, `seedCode()`, `playSeed(code)`.

Three gotchas, all of which have cost time:

**`choose()` enforces `if (key === S.lead) return`.** The backup pick must be
a different pillar from the lead. A harness that ignores that never advances.

**`tick()` returns nothing. Drain the queue with `drain()`.** Through v13 it
ended `return events.splice(0)` and every caller ignored the return, so the
two events the engine emits from inside a tick were thrown away before any
screen could read them — which is why no live inject had ever rendered in a
browser and why a stage nobody answered froze instead of breaching. There is
one drain point. Keep it that way.

**`#ABCDE` is read once, at module load.** A harness that navigates to
`file.html#SEED` on an already loaded page performs a same-document
navigation, nothing reloads, and the run is whatever seed the page booted
with. Reload, then assert `TR.S.seedCode` is the code you asked for. A seeded
test that is not seeded is worse than no test.

Runs are seeded and reproducible. `#ABCDE` in the URL fragment plays the
identical five stages, and there is a run-code field on the attract screen and
a copy-link button on the result screen, so it is reachable without editing a
URL. `#ABCDE,dark` carries the theme too. That is what makes a reported bug
reproducible and lets two people at a stand be given the same run.

## Open items

Tracked in `NOTES.md`. The two that were live promises rather than features —
the offline claim and the scorecard email — are closed. The `CONFIG` TODOs
around the campaign landing page and the privacy URL are not, and they are
not code problems.
