# N-able Threat Response

A two-minute ransomware decision simulator. The player leads with a defence
layer, backs it up with a second, and sees what the combination costs them
when an attack plays out.

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
- Verify by running `npm run build`, then opening `dist/index.html` with the
  network disabled. Not by trusting the dev server.

## Commands

```bash
npm run dev      # dev server with hot reload — use this while iterating
npm run build    # single-file output to dist/index.html
npm run test     # scoring and scenario-integrity tests
```

## Structure

```
src/
  main.js               entry — wires everything together
  data/scenarios.json   all scenario content, no logic
  engine/               game state machine, scoring, no DOM access
  render/               canvas background, screen-shake/flash/vignette effects
  screens/              one module per screen (intro, choice, outcome, results)
  styles/               tokens.css first, then the rest
  assets/fonts/         self-hosted woff2 files
tests/                  vitest — engine only, no DOM needed
```

Two rules that matter more than the rest of the layout:

**`engine/` must not touch the DOM.** State transitions and scoring take
inputs and return outputs. That is what makes them testable, and the scoring
is the part most worth testing — if one defence layer is quietly dominant, the
game has no tension and no teaching value.

**`data/scenarios.json` must contain no logic.** The point of separating it is
that someone on the security team can write a new scenario without reading any
JavaScript. If a scenario needs a code change to work, the schema is wrong —
fix the schema.

## Visual identity

This came from v12 and should be preserved, not redesigned. Deep violet-black
base, cyan-green as the "good outcome" signal, hot red for damage. It reads as
a SOC console without being the usual black-and-acid-green cliché.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0C0820` | page base |
| `--bg2` | `#140A2C` | secondary base |
| `--panel` | `#190F3A` | panel fill |
| `--panel2` | `#22165A` | raised panel |
| `--line` | `#2C2058` | hairline borders |
| `--line2` | `#3E2E80` | emphasised borders |
| `--text` | `#EDE9FB` | body text |
| `--dim` | `#A99FC8` | secondary text |
| `--faint` | `#6A5E92` | tertiary text |
| `--brand` | `#8B5CF6` | N-able violet, primary accent |
| `--green` | `#33E6AE` | contained / good outcome |
| `--blue` | `#4FA8FF` | informational |
| `--violet` | `#C9A6FF` | highlight |
| `--amber` | `#FFB23E` | warning |
| `--red` | `#FF4D67` | breach / damage |

Each colour also has a `-deep` variant for fills behind text and a `-b`
variant for brighter accents. Radii: `--r: 16px`, `--r-sm: 11px`.

Type:
- **Chakra Petch** — HUD, headings, anything that should read as instrumentation
- **Inter** — body copy and UI
- **JetBrains Mono** — numbers, timers, telemetry
- **Space Grotesk** — present in v12; check whether it is actually used and
  drop it if not. Four families for one page is at least one too many.

## Motion

The existing effects — screen shake, red flash, vignette pulsing to `.alert`
and `.crit` — are the game's main feedback channel and worth keeping. Two
things to hold to:

- Motion should answer a player action or signal a state change. Ambient
  animation on idle elements adds noise, not tension.
- Respect `prefers-reduced-motion`. Suppress shake, flash and the canvas
  background under it; keep colour-based state changes so no information is
  lost. This is a work tool shown to customers, and vestibular triggers are
  a real accessibility problem, not a checkbox.

## Quality floor

- Works down to 375px wide. It gets played on phones at events.
- Visible keyboard focus, and the whole game completable without a mouse.
- Touch targets 44px minimum.
- Colour is never the only carrier of meaning — outcomes need text too.

## Writing

Copy is in the voice of a security console, not a person. States what
happened and what it cost. No apologising, no exclamation marks, no
congratulating the player on a correct answer — the outcome numbers are the
feedback. Sentence case throughout. Avoid all-caps labels except in the HUD,
where they are part of the instrumentation look.

## Conventions

- Vanilla JS, ES modules, no framework. It is a linear state machine and does
  not need one.
- Plain CSS with custom properties. No preprocessor, no Tailwind.
- No dependency added without a reason that survives being asked twice —
  every one is bytes in a file that has to work offline.
