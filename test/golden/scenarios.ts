/**
 * The players whose runs get recorded as golden vectors.
 *
 * These only ever run while recording. The committed vectors hold the concrete
 * actions each one produced, and the test replays *those* — so a scenario can
 * be rewritten, or deleted, without invalidating a vector it authored. What is
 * under test is the engine, not the bot.
 *
 * Each scenario must be a pure function of the state it is handed. A bot that
 * consulted a clock or a random number would record an action list the engine
 * could never reproduce.
 */

import type { Action, RunState, WordSource } from "../../src/engine"
import { reduce } from "../../src/engine"

export type Scenario = {
  name: string
  /** What this run is meant to pin down, for whoever reads a failure. */
  covers: string
  seed: number
  /** The next batch of actions, or null to stop. */
  next: (state: RunState, words: WordSource) => Action[] | null
}

const typeWord = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** Every action the engine accepted, dry-run — nothing here mutates the run. */
function accepted(state: RunState, words: WordSource, actions: Action[]): boolean {
  let current = state
  for (const action of actions) {
    const result = reduce(current, action, words)
    if (result.events.some((event) => event.type === "rejected")) return false
    current = result.state
  }
  return true
}

/**
 * The first candidate the engine will actually take. Boss rules refuse whole
 * classes of word — two vowels, no repeats — and a destroyed letter cannot be
 * typed at all, so a bot that assumes its guess lands would stall the recorder
 * on a blind it can never submit to.
 */
function firstPlayable(
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

/**
 * A change of mind before the real word. Backspace is the one action nothing
 * else here would ever produce, and typing the answer's own first letter is
 * always legal — answers are drawn to avoid burnt-out letters, so the draft is
 * guaranteed to accept it and the erase leaves the guess exactly as it was.
 */
function withCorrection(state: RunState, guess: Action[] | null): Action[] | null {
  const letter = state.blind.answer[0]
  if (!guess || !letter) return guess
  return [{ type: "type_letter", letter }, { type: "backspace" }, ...guess]
}

/** Words that are not the answer, walked from a seed-independent offset. */
function decoys(state: RunState, words: WordSource, offset: number): string[] {
  const list = words.answers
  const out: string[] = []
  for (let i = 0; i < 40; i++) {
    const word = list[(offset + i * 97) % list.length]
    if (word && word !== state.blind.answer) out.push(word)
  }
  return out
}

/** Bank the reward, then leave the shop without spending. */
function passThrough(state: RunState): Action[] | null {
  if (state.phase === "reward") return [{ type: "collect" }]
  if (state.phase === "shop") return [{ type: "next_blind" }]
  return null
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "greedy-solver",
    covers: "the solve bonus at its largest, and a shop purchase every time one is affordable",
    seed: 1,
    next: (state, words) => {
      if (state.phase === "blind") return firstPlayable(state, words, [state.blind.answer])
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const index = state.shop?.items.findIndex((item) => item && item.cost <= state.gold) ?? -1
        if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
          return [{ type: "buy", index }]
        }
        return [{ type: "next_blind" }]
      }
      return null
    },
  },
  {
    name: "chip-farmer",
    covers:
      "grays scoring, the guess budget spent down to one, and the solve bonus at its smallest",
    seed: 7,
    next: (state, words) => {
      if (state.phase === "blind") {
        const spent = state.blind.guesses.length
        // Burn every guess but the last on decoys, then solve. This is the
        // income line: more tiles scored, a far smaller solve multiplier.
        const candidates =
          spent >= state.blind.maxGuesses - 1
            ? [state.blind.answer]
            : [...decoys(state, words, spent * 13), state.blind.answer]
        return firstPlayable(state, words, candidates)
      }
      return passThrough(state)
    },
  },
  {
    name: "banker",
    covers: "a pile banked and then multiplied — the line the scoring rule exists for",
    seed: 2024,
    next: (state, words) => {
      if (state.phase === "blind") {
        // Farm two guesses, then cash in while the multiplier is still large.
        // Solving instantly multiplies nothing and solving on the last guess
        // multiplies by one, so without this scenario the vectors would record
        // the same totals whether the bonus applied to the round or the guess.
        const spent = state.blind.guesses.length
        const candidates =
          spent < 2
            ? [...decoys(state, words, spent * 29), state.blind.answer]
            : [state.blind.answer]
        return firstPlayable(state, words, candidates)
      }
      return passThrough(state)
    },
  },
  {
    name: "never-solves",
    covers: "running a blind out of guesses, and the run ending in defeat",
    seed: 42,
    next: (state, words) => {
      if (state.phase === "blind") return firstPlayable(state, words, decoys(state, words, 5))
      return passThrough(state)
    },
  },
  {
    name: "shopkeeper",
    covers: "reroll, sell, consumables used rather than hoarded, and a corrected draft",
    seed: 1234,
    next: (state, words) => {
      if (state.phase === "blind") {
        // Spend a consumable the moment there is one: the Oracle and the
        // Hermit change what a later guess scores, which is exactly the kind of
        // cross-turn effect a per-guess score list is there to pin down.
        if (state.blind.guesses.length === 0 && state.consumables.length > 0) {
          if (accepted(state, words, [{ type: "use_consumable", index: 0 }])) {
            return [{ type: "use_consumable", index: 0 }]
          }
        }
        return withCorrection(state, firstPlayable(state, words, [state.blind.answer]))
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        if (state.shop?.rerolls === 0 && accepted(state, words, [{ type: "reroll" }])) {
          return [{ type: "reroll" }]
        }
        const index = state.shop?.items.findIndex((item) => item && item.cost <= state.gold) ?? -1
        if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
          return [{ type: "buy", index }]
        }
        // Selling back is the only way the joker slots ever empty, and it is
        // priced — a vector that never sells cannot catch that price moving.
        if (
          state.jokers.length >= 2 &&
          accepted(state, words, [{ type: "sell_joker", index: 0 }])
        ) {
          return [{ type: "sell_joker", index: 0 }]
        }
        return [{ type: "next_blind" }]
      }
      return null
    },
  },
]
