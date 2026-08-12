/**
 * Every type the engine speaks. Deliberately all plain data: a RunState round
 * trips through JSON with nothing lost, which is what makes save/resume and the
 * golden vectors cheap. Note what is *absent* — no PRNG state. Streams are
 * re-derived from the seed plus a coordinate, so there is nothing to serialise.
 */

import type { ModId } from "./modifiers"

export type Color = "green" | "yellow" | "gray"

export type Tile = {
  letter: string
  /** Drives scoring. */
  color: Color
  /** Drives the screen. Differs from `color` only when a boss lies. */
  shown: Color
}

export type GuessRecord = {
  word: string
  tiles: Tile[]
  chips: number
  mult: number
  /**
   * ×(1 + guesses left) when this guess solved the word, else 1. It is recorded
   * here but *not* folded into `score`: the bonus multiplies the blind's total,
   * so it belongs to the round rather than to any one guess.
   */
  solveBonus: number
  /** chips × mult for this guess alone. */
  score: number
}

export type Rarity = "common" | "uncommon" | "rare" | "legendary"

/**
 * Where a scaling joker keeps what it has grown.
 *
 * `data` is absent until the joker actually writes to it, which is what keeps
 * this compatible in both directions: a save written before scaling existed
 * loads unchanged, and a run full of non-scaling jokers adds nothing to the
 * file. Plain numbers only, for the same reason the rest of RunState is plain.
 */
export type JokerInstance = { id: string; data?: Record<string, number> }
export type ConsumableInstance = { id: string }

export type LetterState = {
  /** Extra chips from etchings, added to the base value. */
  etch: number
  /** Removed from the alphabet: cannot be typed, cannot appear in an answer. */
  destroyed: boolean
  /**
   * The modifier stuck to this letter, if any. One at a time — buying a second
   * replaces the first — and it outlives being etched or burnt out.
   */
  mod: ModId | null
}

/** 0 small, 1 big, 2 boss. */
export type BlindIndex = 0 | 1 | 2

export type BlindState = {
  answer: string
  target: number
  maxGuesses: number
  bossId: string | null
  /** Letters typed but not yet submitted. */
  draft: string
  guesses: GuessRecord[]
  score: number
  solved: boolean
  /** No more guesses will be accepted; the outcome is already decided. */
  done: boolean

  /** The Oracle: positions whose letter has been revealed early. */
  revealed: (string | null)[]
  /** The Hermit: letters proven absent without spending a guess. */
  eliminated: string[]
  /** The Magician: promote this guess's first gray to yellow. */
  promote: boolean
}

export type ShopItem =
  | { kind: "joker"; id: string; cost: number }
  | { kind: "consumable"; id: string; cost: number }
  /** A group etching. Keyed by the group, not by a letter — it buys many. */
  | { kind: "etch"; id: string; cost: number }
  /** One level for a named word category. */
  | { kind: "level"; id: string; cost: number }
  /** One level for a slice of the alphabet. */
  | { kind: "range"; id: string; cost: number }
  | { kind: "mod"; letter: string; id: ModId; cost: number }

export type ShopState = {
  /** Slots go null once bought, so the layout does not reflow under the thumb. */
  items: (ShopItem | null)[]
  rerolls: number
}

export type Phase =
  | "blind"
  /** Blind cleared; waiting for the player to bank the reward. */
  | "reward"
  | "shop"
  | "game_over"
  | "victory"

export type RunState = {
  seed: number
  ante: number
  blindIndex: BlindIndex
  phase: Phase
  gold: number
  jokers: JokerInstance[]
  consumables: ConsumableInstance[]
  letters: Record<string, LetterState>
  /**
   * Word category levels, by category id, where absent means level one. Optional
   * and unwritten until a level is bought, on the same reasoning as
   * `JokerInstance.data`: a run that never levels anything costs its save
   * nothing, and a save from before levelling existed loads unchanged.
   */
  levels?: Record<string, number>
  /**
   * Alphabet range levels, by range id, absent meaning level one. Same shape and
   * same reasoning as `levels` — the letters themselves stay in `letters`, since
   * a range level is a property of the slice rather than of any letter in it.
   */
  ranges?: Record<string, number>
  blind: BlindState
  shop: ShopState | null
  /** Set when a blind is cleared, so the reward screen can itemise it. */
  reward: RewardBreakdown | null
}

export type RewardBreakdown = {
  base: number
  unusedGuesses: number
  interest: number
  total: number
}

export type Action =
  | { type: "start_run"; seed: number }
  | { type: "type_letter"; letter: string }
  | { type: "backspace" }
  | { type: "submit" }
  | { type: "use_consumable"; index: number }
  | { type: "collect" }
  | { type: "buy"; index: number }
  | { type: "sell_joker"; index: number }
  | { type: "reroll" }
  | { type: "next_blind" }

/**
 * A flat, ordered log the UI replays as animation. Scoring events carry the
 * *running* chips and mult so the screen can render them without re-deriving
 * anything — the UI stays a dumb projection of this stream.
 */
export type GameEvent =
  | { type: "rejected"; reason: string }
  | { type: "tile"; index: number; gained: number; chips: number; mult: number }
  | { type: "joker"; slot: number; id: string; label: string; chips: number; mult: number }
  /**
   * A joker permanently growing. Distinct from `joker` because it happens
   * outside the scoring pipeline, where there is no running chips or mult for
   * it to quote — and because the screen should say "this is worth more now"
   * differently from how it says "this just paid".
   */
  | { type: "joker_grew"; slot: number; id: string; label: string }
  /** A letter's own modifier firing, on the tile that carried it. */
  | {
      type: "mod"
      index: number
      letter: string
      id: ModId
      label: string
      chips: number
      mult: number
    }
  /**
   * A levelled word category paying out, between the tiles and the jokers. Only
   * emitted when it is actually worth something — at level one the category is
   * still named on the board, but it has nothing to announce.
   */
  | { type: "category"; id: string; name: string; level: number; chips: number; mult: number }
  /** `total` is the blind's score *after* the multiply, not the guess's. */
  | { type: "solve_bonus"; factor: number; total: number }
  | { type: "guess_scored"; score: number; total: number }
  | { type: "letter_destroyed"; letter: string }
  | { type: "consumable"; id: string; label: string }
  | { type: "blind_won" }
  | { type: "blind_lost" }
  | { type: "gold"; delta: number; reason: string }
  | { type: "shop_entered" }
  | { type: "run_won" }

export type Reduced = { state: RunState; events: GameEvent[] }

/**
 * The word lists are ~100 KB of text, so they are fetched by the shell rather
 * than imported — which would drag I/O into a pure module. They arrive here as
 * an argument instead.
 */
export type WordSource = {
  answers: readonly string[]
  allowed: ReadonlySet<string>
}
