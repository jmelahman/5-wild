import { ALPHABET } from "../content/letters"
import { CATEGORIES } from "./categories"
import { CONSUMABLES } from "./consumables"
import { ETCHINGS } from "./etchings"
import type { Joker } from "./jokers"
import { JOKERS } from "./jokers"
import type { ModId } from "./modifiers"
import { MODIFIER_BY_ID } from "./modifiers"
import type { Rng } from "./rng"
import { pick } from "./rng"
import type { RunState, ShopItem, ShopState } from "./state"

const BASE_REROLL = 3

export const rerollCost = (shop: ShopState): number => BASE_REROLL + shop.rerolls

/** Half price, rounded down, never nothing. */
export const sellValue = (cost: number): number => Math.max(1, Math.floor(cost / 2))

/**
 * What one word-category level costs, flat: the card says the price it charges.
 *
 * Priced against the modifier line rather than in the abstract. A $4 Chip
 * modifier is worth roughly five score a gold on the guesses it lands in; a
 * level at $8 is worth about seven. Levels stay the better long-run buy — they
 * are the only thing in the run that compounds, and the rubric asked for one —
 * but not by so much that the letter slot becomes something to skip.
 */
const LEVEL_COST = 8

/**
 * The upgrade slot: the run's two permanent scaling lines. An etching raises what
 * *letters* are worth, a level raises what a *shape of word* is worth, and a card
 * turns up often enough that the slot is not the same shape every visit.
 */
const UPGRADE_TABLE = [
  "etch",
  "etch",
  "etch",
  "level",
  "level",
  "level",
  "consumable",
  "consumable",
] as const

/** The letter slot: depth, sold as a modifier on one letter. Same alternate. */
const LETTER_TABLE = ["mod", "mod", "mod", "consumable"] as const

/**
 * Which modifier a modifier slot offers. Weighted rather than uniform: the two
 * ×mult ones are the build-defining pair and should feel like a find, not like
 * the default stock.
 */
const MOD_TABLE: readonly ModId[] = [
  "chip",
  "chip",
  "mult",
  "mult",
  "gold",
  "wild",
  "steel",
  "glass",
]

const rollConsumable = (rng: Rng): ShopItem => {
  const card = pick(rng, CONSUMABLES)
  return { kind: "consumable", id: card.id, cost: card.cost }
}

/**
 * A modifier on a letter that can still be typed and does not already carry it.
 * Null when there is no such pairing left, which hands the slot back to the
 * ordinary roll rather than selling a card that would do nothing.
 */
function rollMod(state: RunState, rng: Rng): ShopItem | null {
  const modifier = MODIFIER_BY_ID.get(pick(rng, MOD_TABLE))
  if (!modifier) return null
  const candidates = [...ALPHABET].filter(
    (letter) => !state.letters[letter]?.destroyed && state.letters[letter]?.mod !== modifier.id,
  )
  if (candidates.length === 0) return null
  return { kind: "mod", letter: pick(rng, candidates), id: modifier.id, cost: modifier.cost }
}

/**
 * An etching whose group still has a letter alive in it. Groups stack forever,
 * so unlike every other slot there is nothing to dedupe against — buying the
 * same etching twice is the whole idea.
 */
function rollEtch(state: RunState, rng: Rng): ShopItem | null {
  const usable = ETCHINGS.filter((etching) =>
    [...etching.letters].some((letter) => !state.letters[letter]?.destroyed),
  )
  if (usable.length === 0) return null
  const etching = pick(rng, usable)
  return { kind: "etch", id: etching.id, cost: etching.cost }
}

function rollUpgrade(state: RunState, rng: Rng): ShopItem {
  const kind = pick(rng, UPGRADE_TABLE)
  if (kind === "etch") {
    const item = rollEtch(state, rng)
    if (item) return item
  }
  if (kind === "level") {
    // Uniform across the categories, because the player picks the shape they
    // build toward rather than being dealt one — a rare category is harder to
    // type on purpose, not harder to find on the shelf. Balatro's model, where
    // the offer leans toward hands you have actually played, would need play
    // counts in the run state; it is the upgrade if uniform reads as noise.
    const category = pick(rng, CATEGORIES)
    return { kind: "level", id: category.id, cost: LEVEL_COST }
  }
  return rollConsumable(rng)
}

function rollLetter(state: RunState, rng: Rng): ShopItem {
  if (pick(rng, LETTER_TABLE) === "mod") {
    const item = rollMod(state, rng)
    if (item) return item
  }
  return rollConsumable(rng)
}

/** Jokers already owned are off the table — duplicates do not stack. */
const unowned = (state: RunState): readonly Joker[] => {
  const owned = new Set(state.jokers.map((instance) => instance.id))
  return JOKERS.filter((joker) => !owned.has(joker.id))
}

const jokerItem = (joker: Joker): ShopItem => ({
  kind: "joker",
  id: joker.id,
  cost: joker.cost,
})

/**
 * A fixed layout rather than four weighted rolls:
 *
 * ```
 *   slot 0   joker
 *   slot 1   joker — and the cap, never a third
 *   slot 2   upgrade: an etching group, or a card
 *   slot 3   letter: a modifier, or a card
 * ```
 *
 * Every visit now offers the same four kinds of decision. The old version rolled
 * each slot from one weighted table and could legally deal four etchings — a
 * shop with no build decision in it at all — which is what the retry loop and
 * the dedupe key dance existed to paper over. A layout that cannot deal a
 * duplicate does not need either, so both are gone.
 *
 * The two joker slots keep their fallback for the late run where every joker is
 * already owned; they fall through to what the slot beside them would have sold.
 */
export function rollShop(state: RunState, rng: Rng, rerolls: number): ShopState {
  const pool = unowned(state)
  const first = pool.length > 0 ? pick(rng, pool) : null
  // The one dedupe that survives, because it is the one the layout cannot make
  // impossible: two joker slots drawing from one pool.
  const rest = first ? pool.filter((joker) => joker.id !== first.id) : pool
  const second = rest.length > 0 ? pick(rng, rest) : null

  return {
    items: [
      first ? jokerItem(first) : rollUpgrade(state, rng),
      second ? jokerItem(second) : rollLetter(state, rng),
      rollUpgrade(state, rng),
      rollLetter(state, rng),
    ],
    rerolls,
  }
}
