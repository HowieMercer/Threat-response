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

Current built size: **~219 KB**, of which 45 KB is subsetted woff2.

## Commands

```bash
npm run dev              # dev server with hot reload
npm run build            # single-file output to dist/index.html
npm test                 # engine, scenario integrity and QR round-trip
npm run verify           # headless playthroughs, layout audit, offline check
npm run verify -- --shots   # ...and write screenshots to tests/shots/
npm run balance          # Monte Carlo answer-key and strategy report
```

Run `npm run balance` after **any** change to `src/data/scenarios.json`. A
drift of a few points is noise; a strategy moving ten points means the answer
key changed shape.

## Structure

```
src/
  main.js               entry — wires engine to screens, owns no rules
  config.js             VERSION, CONFIG, storage key, stage pacing
  data/*.json           all content, no logic
  engine/               state machine, resolution, scoring — no DOM
  render/               canvas field, screen effects, synthesized audio
  ui/                   DOM helper, board components, icons, QR encoder
  screens/              one module per screen
  styles/               tokens.css first, then base/hud/stage/screens/result
  assets/fonts/         self-hosted woff2
tests/                  vitest (engine + QR) plus two node scripts
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
   blind or positional player can beat it.

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
    "at": 55, "seconds": 5,
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
- `inject` — optional. A live inject firing at intrusion depth `at`. Keep them
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

Deep violet-black base, cyan-green as the "good outcome" signal, hot red for
damage. It reads as a SOC console without being the usual black-and-acid-green
cliché.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0C0820` | page base |
| `--bg2` | `#140A2C` | secondary base |
| `--panel` | `#190F3A` | panel fill |
| `--panel2` | `#22165A` | raised panel |
| `--line` | `#2C2058` | hairline borders |
| `--line2` | `#3E2E80` | emphasized borders |
| `--text` | `#EDE9FB` | body text |
| `--dim` | `#A99FC8` | secondary text |
| `--faint` | `#6A5E92` | tertiary text |
| `--brand` | `#8B5CF6` | N-able violet, primary accent |
| `--green` | `#33E6AE` | contained / good outcome |
| `--blue` | `#4FA8FF` | informational, and the Manage accent |
| `--violet` | `#C9A6FF` | highlight, and the Secure accent |
| `--amber` | `#FFB23E` | warning / mitigated |
| `--red` | `#FF4D67` | breach / damage |

Each color has a `-deep` variant for fills behind text and a `-b` variant for
brighter accents. Radii: `--r: 16px`, `--r-sm: 11px`. Pillar tones are applied
with the `.t-blue` / `.t-violet` / `.t-green` classes, which set `--tone`, so a
card, a chip and a map marker for the same pillar cannot drift apart.

Note: official N-able brand hex codes are still a pre-launch confirmation item
and have not been formally signed off.

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
  scanlines, screen shake, the flash, sparks, the delta-chip stagger and the
  climax countdown. It keeps color state, the intrusion track's position and
  the estate map, because suppressing those would remove information rather
  than motion. `npm run verify` checks this.

## Quality floor

- Works down to 375px wide, and the three pillar cards are reachable without
  scrolling at 375×667 — the intrusion track advances while a player scrolls,
  so that is a gameplay requirement, not a cosmetic one.
- Visible keyboard focus, and the whole game completable without a mouse.
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
`report()`, `openStats()`, `seedCode()`.

The gotcha that has cost time before: `choose()` enforces
`if (key === S.lead) return`. The backup pick must be a different pillar from
the lead. A harness that ignores that never advances.

Runs are seeded and reproducible. `#ABCDE` in the URL fragment plays the
identical five stages, which is what makes a reported bug reproducible and
lets two people at a stand be given the same run.

## Open items

Tracked in `NOTES.md`. The two that were live promises rather than features —
the offline claim and the scorecard email — are closed. The `CONFIG` TODOs
around the campaign landing page and the privacy URL are not, and they are
not code problems.
