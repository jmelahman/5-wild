/**
 * A player that does not know the answer.
 *
 * Every bot in `test/golden/scenarios.ts` reads `state.round.answer` (line 79,
 * line 90, line 132) and is right to: a recorder wants a run that reaches a
 * particular rule, and the shortest path there is to type the word. That makes
 * them useless for the other question. "Is the stage 6 target fair" is a question
 * about somebody who has to *find* the word, and nothing that reads the answer
 * can answer it.
 *
 * So this one is handed a `PlayerView`, which is the run state with `answer`
 * destructured off it. Not a convention: the field is genuinely absent from the
 * object at runtime, so a policy that tried to cheat would read `undefined`
 * rather than the word, and `test/sim.test.ts` asserts the absence. The point of
 * a blind player is the claim that it played blind, and a claim enforced by
 * discipline is worth what discipline is worth.
 *
 * It is deliberately *not* pure the way a scenario is. A scenario has to be, or
 * the recorder could not reproduce its action list; this thing records nothing,
 * so it is free to carry the one piece of state that makes it affordable, the
 * shrinking candidate pool. Re-deriving that from scratch on every guess is what
 * took the first draft from seconds to minutes.
 */

import type { Action, Color, RoundState, RunState, ShopItem, WordSource } from "../../src/engine"
import { baseChips, computeFeedback, LETTER_CHIPS, reduce } from "../../src/engine"
import { placeMod } from "../golden/scenarios"

/**
 * The run as a player sees it. `round.answer` is gone; everything else stays,
 * including `bossId` and `round.target`. Both are on the screen, and a player
 * who could not see what they were up against would be blind in a way the game
 * never asks anyone to be.
 */
export type PlayerView = Omit<RunState, "round"> & { round: Omit<RoundState, "answer"> }

export function playerView(state: RunState): PlayerView {
  const { answer: _hidden, ...round } = state.round
  return { ...state, round }
}

/**
 * How a player spends the guess budget. The whole tension the game is built on
 * is which of these two a round wants, so the simulator's job is to price both
 * rather than to pick one.
 *
 * Everything *else* the two do, shopping, packs, where a modifier goes, is
 * shared code below, on purpose. If the shop policies differed, a gap between
 * the two lines would not be attributable to the line.
 */
export type Policy =
  /** Guess to find the word. Fewest guesses spent, largest solve bonus. */
  | "solver"
  /** Burn the early guesses on chips, then solve. More tiles scored, smaller bonus. */
  | "farmer"

/**
 * How many guesses the farmer keeps in hand to actually find the word with.
 *
 * Four, which leaves it two to farm, and four because the income line gets
 * worse the harder it is played. Over 60 seeds at v21, median stage reached:
 * reserve 2 → 1, reserve 3 → 3, reserve 4 → 5, against the solver's 5.
 *
 * Median saturates there, so it is the wrong column to read at the top end: at
 * reserve 4 the farmer ties the solver on it. Over 300 seeds the run win rate
 * separates them and the ordering holds: 7.3% for the solver against 3.3% for
 * this farmer, which is as close as the income line ever gets.
 *
 * That ordering is not a quirk of this policy, it is the scoring rule showing
 * through. Mult comes from colors and colors come from being right, so a
 * guess thrown at chips alone scores its tiles at ×1 and buys nothing toward
 * the next one. Income is worth taking when a guess you wanted anyway happens to
 * be rich; it does not survive being made the plan. The constant is set to the
 * kindest version of the strategy on purpose, since a strawman farmer would make the
 * comparison say nothing.
 */
const FARMER_RESERVE = 4

/**
 * Openers are ranked once and reused. The first guess of every round faces the
 * same untouched candidate pool, so the ranking cannot change, only which of
 * the top few a boss will accept, and what the run's etchings have done to the
 * chip tie-break.
 */
const OPENERS = 40

/**
 * How deep into the allowed list the farmer will look for chips. Wide enough
 * that there is still something rich left after the untried-letter filter has
 * taken the z- and q-words away, which happens by about the third guess.
 */
const INCOME = 400

/**
 * How close to the most informative guess still counts as just as informative.
 * The knob that decides how much of a chip premium a player will pay for a word
 * that narrows the pool slightly less well.
 */
const BAND = 0.9

const twin = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Chips a word is worth from the letter table alone, before the run touched it. */
const tableChips = (word: string) =>
  [...word].reduce((total, letter) => total + (LETTER_CHIPS[letter] ?? 0), 0)

/**
 * How much a guess would tell us, scored as the pool-frequency of its distinct
 * letters. A real solver would measure the expected split of the pool, which is
 * quadratic in its size and would dominate the runtime of the whole simulator;
 * this agrees with it on the opening word and disagrees only in the endgame,
 * where the pool is small enough that it rarely costs a guess.
 */
function information(word: string, freq: Map<string, number>): number {
  let total = 0
  for (const letter of new Set(word)) total += freq.get(letter) ?? 0
  return total
}

function frequencies(pool: readonly string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const word of pool) {
    for (const letter of new Set(word)) freq.set(letter, (freq.get(letter) ?? 0) + 1)
  }
  return freq
}

/** Every action the engine accepted, dry-run. The twin of the one in scenarios.ts. */
function accepted(state: RunState, words: WordSource, actions: readonly Action[]): boolean {
  let current = state
  for (const action of actions) {
    const result = reduce(current, action, words)
    if (result.events.some((event) => event.type === "rejected")) return false
    current = result.state
  }
  return true
}

const typeWord = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/**
 * The first candidate the engine will actually take. A boss refuses whole
 * classes of word and a destroyed letter cannot be typed at all, so a player
 * that assumed its guess landed would stall on a round it can never submit to.
 */
function playable(
  state: RunState,
  words: WordSource,
  candidates: readonly string[],
): Action[] | null {
  for (const word of candidates) {
    const actions = typeWord(word)
    if (accepted(state, words, actions)) return actions
  }
  return null
}

/** What a shop item is worth taking first, high to low. */
function appeal(item: ShopItem): number {
  if (item.kind === "relic") return 5
  if (item.kind === "mod") return 4
  if (item.kind === "pack") return 3
  if (item.kind === "etch") return 2
  return 1
}

export type BlindPlayer = {
  /** The next batch of actions, or null to stop. Fed the real state; sees a view. */
  next: (state: RunState, words: WordSource) => Action[] | null
}

export function blindPlayer(policy: Policy): BlindPlayer {
  let pool: string[] = []
  let openers: string[] = []
  let income: string[] = []
  let key = ""
  let filtered = 0

  /**
   * Narrow the pool by the guesses that have landed since the last look.
   *
   * The filter is `computeFeedback(guess, candidate) === what we were shown`,
   * which is exact where a hand-rolled green/yellow/gray check gets duplicate
   * letters wrong, and it is the engine's own function, so the player is
   * reasoning with precisely the rule it is being scored under.
   *
   * Note `tile.shown` rather than `tile.color`. Under The Fog and The Mirror
   * those differ, and reading the one the screen paints is what makes this a
   * player rather than an oracle. It also means a lying boss can eliminate the
   * true answer, which is why the empty case below is a reset rather than a bug.
   */
  function narrow(view: PlayerView, words: WordSource): void {
    const round = view.round
    const here = `${view.stage}:${view.roundIndex}`
    if (here !== key) {
      key = here
      filtered = 0
      pool = [...words.answers]
    }

    for (const guess of round.guesses.slice(filtered)) {
      const shown: Color[] = guess.tiles.map((tile) => tile.shown)
      pool = pool.filter((word) => twin(computeFeedback(guess.word, word), shown))
    }
    filtered = round.guesses.length

    // The Oracle hands over a position outright; The Hermit rules letters out
    // without spending a guess. Both are on the screen, so both are ours.
    if (round.revealed.some(Boolean)) {
      pool = pool.filter((word) =>
        round.revealed.every((letter, i) => !letter || word[i] === letter),
      )
    }
    if (round.eliminated.length) {
      const dead = new Set(round.eliminated)
      pool = pool.filter((word) => ![...word].some((letter) => dead.has(letter)))
    }

    // A boss that repaints feedback can talk us out of the truth. Falling back
    // to everything not already guessed is what a player does when the board
    // stops making sense, and it keeps the run going rather than deadlocking.
    if (pool.length === 0) {
      const spent = new Set(round.guesses.map((guess) => guess.word))
      pool = words.answers.filter((word) => !spent.has(word))
    }
  }

  function guess(state: RunState, words: WordSource): Action[] | null {
    const view = playerView(state)
    narrow(view, words)

    const chips = (word: string) =>
      [...word].reduce((total, letter) => total + baseChips(state, letter), 0)

    // Income first, while there is budget for it. The farmer is buying tiles,
    // not information, so it reaches outside the candidate pool for the richest
    // words in the whole allowed list: the same trade `chip-farmer` makes in
    // the vectors, made by somebody who does not know how the round ends.
    //
    // The `fresh` filter is not a refinement, it is the difference between a
    // policy and a bug. Ranking by chips alone names the same word every guess,
    // because nothing about the ranking changes when it is played; the first
    // draft spent four guesses on one word and went to the last two knowing
    // nothing. Requiring an untried letter costs a little chip value and is
    // what makes this an income *line* rather than a stuck one.
    const left = view.round.maxGuesses - view.round.guesses.length
    if (policy === "farmer" && left > FARMER_RESERVE && pool.length > 1) {
      if (income.length === 0) {
        income = [...words.allowed].sort((a, b) => tableChips(b) - tableChips(a)).slice(0, INCOME)
      }
      const tried = new Set(view.round.guesses.flatMap((guess) => [...guess.word]))
      const fresh = income.filter((word) => [...word].some((letter) => !tried.has(letter)))
      const ranked = fresh.sort((a, b) => chips(b) - chips(a))
      const played = playable(state, words, ranked)
      if (played) return played
    }

    const first = view.round.guesses.length === 0
    if (first && openers.length === 0) {
      const freq = frequencies(pool)
      openers = [...pool]
        .sort((a, b) => information(b, freq) - information(a, freq))
        .slice(0, OPENERS)
    }

    // Rank by what the guess would tell us, then take the best-paying of the
    // ones that tell us roughly the same thing.
    //
    // The band is the whole point. Sorting on information and using chips as a
    // strict tie-break sounds equivalent and is not: information here is a sum
    // of pool frequencies running to the thousands, so exact ties essentially
    // never occur and the chip term never fires at all. That solver was blind to
    // chips in a game about chips, and it died on stage one of 39 runs in 300.
    // Treating anything within `BAND` of the best as equally informative is what
    // lets it prefer the richer of two words that would tell it the same thing.
    const freq = frequencies(pool)
    const from = first ? openers : pool
    const scored = from.map((word) => ({ word, info: information(word, freq) }))
    const best = scored.reduce((top, next) => Math.max(top, next.info), 0)
    const ranked = scored
      .filter((entry) => entry.info >= best * BAND)
      .sort((a, b) => chips(b.word) - chips(a.word) || b.info - a.info)
      .map((entry) => entry.word)
    return playable(state, words, ranked.length ? ranked : pool)
  }

  return {
    next(state, words) {
      // Forced, not strategy: the shop refuses everything else until a bought
      // modifier has been pointed at a letter. Same answer as the vectors give.
      if (state.placing) return placeMod(state)

      const pack = state.pack
      if (pack) {
        const index = pack.options.findIndex(Boolean)
        return index >= 0 ? [{ type: "pick_pack", index }] : [{ type: "skip_pack" }]
      }

      if (state.phase === "round") return guess(state, words)
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "victory") return null
      if (state.phase === "shop") {
        // Dearest affordable thing first, relics before modifiers before packs.
        // Shared by both policies deliberately: if the shopping differed, a gap
        // between the two lines could not be blamed on the line.
        const items = state.shop?.items ?? []
        const wanted = items
          .map((item, index) => ({ item, index }))
          .filter(
            (slot): slot is { item: ShopItem; index: number } =>
              slot.item !== null && slot.item.cost <= state.gold,
          )
          .sort((a, b) => appeal(b.item) - appeal(a.item) || b.item.cost - a.item.cost)
        for (const slot of wanted) {
          if (accepted(state, words, [{ type: "buy", index: slot.index }])) {
            return [{ type: "buy", index: slot.index }]
          }
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  }
}
