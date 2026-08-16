# CLAUDE.md

The README covers running it, the layout, the release flow and the golden-vector
protocol. Read that first. This is what it does not say.

## The shape of the thing

`src/engine` is a pure reducer: `reduce(state, action, words)` returns a new
state and a list of events. It imports only itself and `src/content`, and
`test/engine-purity.test.ts` enforces that rather than trusting discipline. All
randomness goes through `derive(seed, ...coords)` in `rng.ts` — never
`Math.random`, never a clock.

`RunState` is plain JSON. It round-trips through `JSON.parse(JSON.stringify(…))`
and a test asserts it, so no Maps, Sets, Dates or class instances may enter it.
Saves and golden vectors both rest on that.

A run is a closed world. Anything outliving one belongs in `src/ui/meta.ts`, not
the engine — ascension is the clear case: it is an *input* to `startRun`, the UI
remembers which level was chosen, and the engine never learns a browser exists.

## The UI

No framework. `h()` in `src/ui/dom.ts` builds DOM, `views.ts` is pure
`state → HTMLElement`, `app.ts` owns dispatch.

**Every dispatch rebuilds the whole screen** — `clear(this.root).append(view)`.
Two things follow: view code can assume it builds from scratch, and any state the
browser owns — focus, scroll position, an open `<details>` — is destroyed on
every render and has to be restored deliberately. `holdFocus()` is that
restoration for open sheets.

Two exceptions, both bought by the same defect: `.grid` sizes itself in
container-query units, and Gecko cannot resolve those against a container built
in the same pass, so a board that is rebuilt is a board that flashes at the wrong
size for a frame. `patchDraft` redraws the row being typed in place, and
`reuseBoard` keeps `.grid-wrap` — the container itself — across a round-to-round
render, splicing the new screen in around it. Neither reaches the views: the
reused node is an empty box, and everything drawn inside it is still built from
scratch.

Mobile first: portrait, thumb-reachable, sheets rising from the bottom edge
rather than centred. Anything with a `data-tip` gets the hover panel on a mouse
and a long-press one on a finger, so a new affordance usually only needs the
attribute. Purely presentational settings live as a class on the document root
and are switched off in the stylesheet — see `.plain` and `.quiet` — rather than
threaded through the views, which the full rebuild would otherwise make every
view's business.

Tests run in Node with no DOM — there is no jsdom. `test/ui` covers pure logic
only; rendering and interaction get validated in a real browser instead.

## Changing balance

The README has the mechanics — bump `CONTENT_VERSION`, `npm run golden`, read the
diff. What it does not state is the standard of evidence. Balance comments here
cite run counts because the numbers came from actually simulating the change, and
a nerf argued from intuition will read as out of place beside them. A throwaway
harness over a few hundred seeds costs minutes: write one, quote what it said,
delete it. Batch balance edits into a single commit so the vector diff reads as
one deliberate move.

Watch for tests that pin balance incidentally. A shelf reshuffle moves outcomes
on seeds nobody was thinking about, and the right repair is usually to assert the
distribution rather than to renumber the expectation.

## Comments

The house style is heavy and deliberately so: comments explain *why*, and record
what was tried and rejected along with the numbers that settled it. Match the
density and the voice of the file you are in. Code written in this codebase's
style but not its prose is half-finished.

## Storage

`5wild:run:v2` (the run save), `5wild:meta:v2` (the record), and four settings:
`5wild:plain`, `5wild:muted`, `5wild:music`, `5wild:coached`. All are booleans
except `5wild:plain`, which holds one of `all`, `minimal` or `none` — how much of
the scoring game the board draws on itself. Adding an optional field needs no key
bump; changing what an existing field means does.

`5wild:coached` is the odd one: it is the only flag that is not a setting. It
records that the first-round tutorial has been spent. There was a
`5wild:seen-help` beside it, meaning the rules sheet had already interrupted a
first launch, and the two were kept apart because a sheet closed at the title
screen is not a round played. It is gone: the sheet no longer opens itself, so
nothing was left to remember. The coaching teaches the scoring half at the moment
each piece of it first becomes true, and the rest of the sheet — shops, bosses,
ascensions — is a button on the title screen and in the pause menu for whoever
wants it. Old installs keep the orphaned key; nothing reads it. Everything else
about the coaching is derived from the run; see `src/ui/coach.ts`.

Renaming a field is the case in between, and the two keys answered it
differently when antes became stages and jokers became relics. The run save
bumped: a v1 save spells half its fields differently, and a run read as half
present is worse than a run refused. The record did not: it is independent
counters, `loadMeta` already reads them one at a time, so it reads the old
spelling where the new one is missing and keeps everything — including the
`cleared` that gates the ladder, which a bump would have thrown away to make a
point about schemas.

## Backlog

`plans/roadmap.md` is the real one — phases, each with a postmortem saying what
the change did to the vectors — and `TODO` at the root is scratch. Both are
gitignored, so a fresh clone will not have either.
