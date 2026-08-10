/**
 * The engine's entire public surface.
 *
 * Nothing outside this directory should reach past this file — the UI is meant
 * to be replaceable, and this is the seam it gets replaced along.
 */

export {
  ANTES,
  BASE_GUESSES,
  BLIND_NAMES,
  BLIND_PAYOUT,
  BLINDS_PER_ANTE,
  blindTargets,
  CONSUMABLE_SLOTS,
  GOLD_PER_UNUSED_GUESS,
  INTEREST_CAP,
  INTEREST_PER,
  JOKER_SLOTS,
} from "../content/blinds"
export { ALPHABET, LETTER_CHIPS } from "../content/letters"
export type { Boss } from "./bosses"
export { BOSSES, getBoss } from "./bosses"
export type { Consumable } from "./consumables"
export { CONSUMABLE_BY_ID, CONSUMABLES } from "./consumables"
export type { Joker } from "./jokers"
export { JOKER_BY_ID, JOKERS } from "./jokers"
export { reduce, startRun } from "./reduce"
export { derive } from "./rng"
export { baseChips } from "./scoring"
export { ETCH_COST, rerollCost, SHOP_SLOTS, sellValue } from "./shop"
export type * from "./state"
export { computeFeedback, keyboardColors } from "./words"
