import { ALPHABET } from "../content/letters"
import type { Rng } from "./rng"
import { shuffled } from "./rng"
import type { GameEvent, RunState } from "./state"

/**
 * One-shot cards. With no deck to manipulate, these act on the two things this
 * game does have: the puzzle and the keyboard. Each one is an answer to a
 * specific problem — being stuck, being fogged, being one guess short — which
 * is what stops them from being a flat resource.
 */
export type Consumable = {
  id: string
  name: string
  text: string
  cost: number
  /** Mutates the run. Returns a reason string when it cannot be used. */
  apply: (state: RunState, rng: Rng, events: GameEvent[]) => string | null
}

const CONSUMABLE_COST = 3

export const CONSUMABLES: readonly Consumable[] = [
  {
    id: "oracle",
    name: "The Oracle",
    text: "Reveal one letter of the answer, in place",
    cost: CONSUMABLE_COST,
    apply: (state, rng, events) => {
      const round = state.round
      const hidden = round.revealed
        .map((value, index) => (value === null ? index : -1))
        .filter((index) => index >= 0)
      const position = shuffled(rng, hidden)[0]
      if (position === undefined) return "the whole word is already revealed"
      const letter = round.answer[position]
      if (letter === undefined) return "nothing to reveal"
      round.revealed[position] = letter
      events.push({
        type: "consumable",
        id: "oracle",
        label: `${letter.toUpperCase()} is #${position + 1}`,
      })
      return null
    },
  },
  {
    id: "hermit",
    name: "The Hermit",
    text: "Rule a letter out of the answer without spending a guess",
    cost: CONSUMABLE_COST,
    apply: (state, rng, events) => {
      const round = state.round
      const known = new Set(round.eliminated)
      for (const guess of round.guesses) for (const letter of guess.word) known.add(letter)

      const candidates = [...ALPHABET].filter(
        (letter) =>
          !round.answer.includes(letter) && !known.has(letter) && !state.letters[letter]?.destroyed,
      )
      const letter = shuffled(rng, candidates)[0]
      if (letter === undefined) return "nothing left to rule out"
      round.eliminated.push(letter)
      events.push({ type: "consumable", id: "hermit", label: `no ${letter.toUpperCase()}` })
      return null
    },
  },
  {
    id: "magician",
    name: "The Magician",
    text: "Your next guess promotes its first gray tile to yellow",
    cost: CONSUMABLE_COST,
    // Applied after the boss rewrites feedback, so this is a real counter to
    // The Silence rather than something it quietly erases.
    apply: (state, _rng, events) => {
      if (state.round.promote) return "already prepared"
      state.round.promote = true
      events.push({ type: "consumable", id: "magician", label: "next gray becomes yellow" })
      return null
    },
  },
  {
    id: "fool",
    name: "The Fool",
    text: "Score your previous guess a second time",
    cost: CONSUMABLE_COST,
    apply: (state, _rng, events) => {
      const round = state.round
      const last = round.guesses[round.guesses.length - 1]
      if (!last) return "no guess to repeat"
      round.score += last.score
      events.push({ type: "consumable", id: "fool", label: `+${last.score}` })
      return null
    },
  },
]

export const CONSUMABLE_BY_ID = new Map(CONSUMABLES.map((card) => [card.id, card]))
