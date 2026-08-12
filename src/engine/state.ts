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
  /**
   * A booster pack. The only item that is not applied when it is bought — it
   * opens instead, and what comes out of it is chosen rather than dealt.
   */
  | { kind: "pack"; id: string; cost: number }

export type ShopState = {
  /** Slots go null once bought, so the layout does not reflow under the thumb. */
  items: (ShopItem | null)[]
  rerolls: number
}

/**
 * A pack laid out on the table, mid-decision.
 *
 * The options are ordinary `ShopItem`s and they keep the price they would have
 * carried in the stock, which is not charged — the pack was paid for already.
 * Carrying it anyway is what lets the screen say what a card is worth, and it
 * means one function applies an item to the run whether it was bought or won.
 */
export type OpenPack = {
  id: string
  /** Cards laid out; a slot goes null once its card has been taken. */
  options: (ShopItem | null)[]
  /** Picks still owed. The pack closes when this reaches zero. */
  picks: number
}

export type Phase =
  | "blind"
  /** Blind cleared; waiting for the player to bank the reward. */
  | "reward"
  | "shop"
  | "game_over"
  /**
   * The final ante's last blind is banked. Not a terminus: the run is complete
   * and the player chooses whether it is over, so this phase is a held screen
   * rather than a stopped machine. `continue_run` releases it into the shop.
   */
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
  /**
   * Whether this run has already cleared the final ante.
   *
   * Set once and never cleared, which is what makes it more than a phase: it is
   * why the win is only offered once however far past ante `ANTES` the run goes,
   * and it is how a run that wins and then dies at ante 14 is told apart from
   * one that simply died. Optional, so a save written before endless existed
   * loads as a run that has not won — which is what it is.
   */
  won?: boolean
  blind: BlindState
  shop: ShopState | null
  /**
   * The pack currently open, if one is. Absent rather than null when there is
   * none, on the same reasoning as `levels` and `ranges`: a save written before
   * packs existed loads unchanged, and a shop visit that buys none adds nothing
   * to the file.
   *
   * While this is set the shop is held: nothing else can be bought, rerolled or
   * left behind until the pack is resolved. A pack is a decision, and letting
   * one sit open while the stock changed underneath it would make the pack's
   * own cards stale.
   */
  pack?: OpenPack | null
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
  /** Play on past the win, into antes nobody authored. */
  | { type: "continue_run" }
  /** Take one of the open pack's cards. */
  | { type: "pick_pack"; index: number }
  /** Walk away from the open pack, forfeiting whatever is left in it. */
  | { type: "skip_pack" }

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
  /** A pack laid out on the table, waiting to be chosen from. */
  | { type: "pack_opened"; id: string; name: string; options: number }
  /** A card taken out of a pack, or the pack walked away from when `label` is null. */
  | { type: "pack_picked"; id: string; label: string | null }
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
