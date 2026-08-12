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
export { CONTENT_VERSION } from "../content/version"
export type { Boss } from "./bosses"
export { BOSSES, getBoss } from "./bosses"
export type { Category } from "./categories"
export {
  CATEGORIES,
  CATEGORY_BY_ID,
  categoryOf,
  isCategory,
  levelBonus,
  levelOf,
} from "./categories"
export type { Consumable } from "./consumables"
export { CONSUMABLE_BY_ID, CONSUMABLES } from "./consumables"
export type { Etching } from "./etchings"
export { ETCHING_BY_ID, ETCHINGS } from "./etchings"
export type { Joker, JokerCtx } from "./jokers"
export { JOKER_BY_ID, JOKERS } from "./jokers"
export type { ModId, Modifier } from "./modifiers"
export { MODIFIER_BY_ID, MODIFIERS, modifierOf } from "./modifiers"
export { reduce, startRun } from "./reduce"
export { derive } from "./rng"
export { baseChips, solveBonusFor } from "./scoring"
export { rerollCost, sellValue } from "./shop"
export type * from "./state"
export { computeFeedback, keyboardColors } from "./words"
