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
The lone exception is `patchDraft`, which patches the current row per keystroke.
Two things follow: view code can assume it builds from scratch, and any state the
browser owns — focus, scroll position, an open `<details>` — is destroyed on
every render and has to be restored deliberately. `holdFocus()` is that
restoration for open sheets.

Mobile first: portrait, thumb-reachable, sheets rising from the bottom edge
rather than centred.

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

`5wild:run:v1` (the run save), `5wild:meta:v1` (the record), `5wild:seen-help`.
Adding an optional field needs no key bump; changing what an existing field means
does.

## Backlog

`plans/roadmap.md` is the real one — phases, each with a postmortem saying what
the change did to the vectors — and `TODO` at the root is scratch. Both are
gitignored, so a fresh clone will not have either.
