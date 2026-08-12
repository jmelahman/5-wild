import { JOKER_SLOTS } from "../content/blinds"
import { ALPHABET } from "../content/letters"
import { CATEGORIES } from "./categories"
import { CONSUMABLES } from "./consumables"
import { ETCHINGS } from "./etchings"
import type { Joker } from "./jokers"
import { JOKERS } from "./jokers"
import type { ModId, Modifier } from "./modifiers"
import { MODIFIER_BY_ID } from "./modifiers"
import type { Pack } from "./packs"
import { PACKS } from "./packs"
import { liveRanges } from "./ranges"
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
 * What one alphabet range level costs. Priced in `ranges.ts` against the etching
 * line it sits beside; the number lives here because the shop is what charges it.
 */
const RANGE_COST = 7

/**
 * The upgrade slot: the run's permanent scaling lines. An etching raises what a
 * *kind* of letter is worth, a range level raises what a *slice of the alphabet*
 * is worth, a category level raises what a *shape of word* is worth, and a card
 * turns up often enough that the slot is not the same shape every visit.
 *
 * Etchings give up a share to make room rather than the slot growing: four kinds
 * of decision in one slot is already the most it can carry legibly, and the two
 * letter lines answer the same question, so they can afford to split a seat.
 */
const UPGRADE_TABLE = [
  "etch",
  "etch",
  "range",
  "range",
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
  "lucky",
  "echo",
  "anchor",
  "steel",
  "glass",
]

const rollConsumable = (rng: Rng): ShopItem => {
  const card = pick(rng, CONSUMABLES)
  return { kind: "consumable", id: card.id, cost: card.cost }
}

/**
 * The letters a modifier could still be put on: ones that can be typed, that do
 * not already carry it, and that the modifier is willing to sit on at all.
 *
 * Exported because it is the same question in three places — whether the shop
 * may stock the card, whether the purchase can be honoured, and which keys the
 * picker lights up — and those three must not be allowed to disagree.
 */
export function placeableLetters(state: RunState, modifier: Modifier): string[] {
  return [...(modifier.letters ?? ALPHABET)].filter(
    (letter) => !state.letters[letter]?.destroyed && state.letters[letter]?.mod !== modifier.id,
  )
}

/**
 * A modifier with no letter on it, for the player to place. Null when there is
 * nowhere left to put it, which hands the slot back to the ordinary roll rather
 * than selling a card that would do nothing.
 *
 * Which letter it lands on is most of what a modifier is worth, and the shop
 * used to roll that too — so the letter slot was a coin flip between "Steel E,
 * buy it immediately" and "Steel Q, walk past". Selling the card and letting the
 * player aim it turns the slot into a decision about their own vocabulary, which
 * is the decision this layer was always supposed to be asking for. It costs more
 * because it is worth more; see `Modifier.choiceCost`.
 */
function rollMod(state: RunState, rng: Rng): ShopItem | null {
  const modifier = MODIFIER_BY_ID.get(pick(rng, MOD_TABLE))
  if (!modifier) return null
  if (placeableLetters(state, modifier).length === 0) return null
  return { kind: "mod", id: modifier.id, cost: modifier.choiceCost }
}

/**
 * A modifier already paired with a letter, for a pack to lay out.
 *
 * The pack keeps rolling the pairing on purpose, now that the shop has stopped.
 * Two routes to the same layer that differ in what they ask of the player — the
 * shop sells the card and makes you aim it, the pack deals three aimed cards and
 * makes you choose between them — and it is the only thing that still gives
 * `Modifier.letters` a job, since a pack is where a Steel Q would otherwise turn
 * up. It is also why the pack is the cheap way in: three shots at a good pairing
 * for one price, at the cost of not picking the letter yourself.
 */
function rollPairing(state: RunState, rng: Rng): ShopItem | null {
  const modifier = MODIFIER_BY_ID.get(pick(rng, MOD_TABLE))
  if (!modifier) return null
  const candidates = placeableLetters(state, modifier)
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

/**
 * A range with a letter left alive in it. Uniform across the four, and unlike
 * the category roll that is not a compromise: the ranges are cut to be worth the
 * same, so there is no rare one to lean the odds toward.
 */
function rollRange(state: RunState, rng: Rng): ShopItem | null {
  const usable = liveRanges(state)
  if (usable.length === 0) return null
  return { kind: "range", id: pick(rng, usable).id, cost: RANGE_COST }
}

function rollUpgrade(state: RunState, rng: Rng): ShopItem {
  const kind = pick(rng, UPGRADE_TABLE)
  if (kind === "etch") {
    const item = rollEtch(state, rng)
    if (item) return item
  }
  if (kind === "range") {
    const item = rollRange(state, rng)
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

/**
 * Whether a joker could actually be taken right now — one exists to offer, and
 * there is somewhere to put it.
 *
 * The slot half matters more for packs than for the joker slots. An unbuyable
 * joker on the shelf costs nothing: the buy is refused and the gold stays put.
 * An unbuyable joker *pack* is a trap, because the gold goes when the pack
 * opens and the refusal comes three cards later.
 */
const canTakeJoker = (state: RunState): boolean =>
  state.jokers.length < JOKER_SLOTS && unowned(state).length > 0

/**
 * Which pack the pack slot offers. Uniform across the three, since each one
 * points at a different line of the run and none is the fallback for another.
 *
 * The joker pack drops out when there is no joker to be had, for the same
 * reason the joker slots do: there would be nothing to lay out in it.
 */
function rollPack(state: RunState, rng: Rng): ShopItem {
  const usable = PACKS.filter((pack) => pack.id !== "joker" || canTakeJoker(state))
  const pack = pick(rng, usable.length > 0 ? usable : PACKS)
  return { kind: "pack", id: pack.id, cost: pack.cost }
}

/**
 * What a pack lays out when it is opened, rolled at open time rather than at
 * stock time so an unopened pack keeps its secret.
 *
 * Distinct cards, not distinct rolls: a pack that laid out Steel E three times
 * would be selling a choice it was not actually offering. The retry budget is
 * what makes that cheap to guarantee without a shuffle — the pools are far
 * larger than three, so a collision is rare and giving up after a few tries
 * costs a short pack rather than a hang.
 *
 * Empty is a meaningful answer, and the caller refuses the sale on it. The
 * shelf goes stale: a joker pack rolled while a slot was free is still sitting
 * there after the joker in the next slot along fills it, and opening it then
 * would spend the gold on three cards none of which could land.
 */
export function packContents(state: RunState, pack: Pack, rng: Rng): ShopItem[] {
  if (pack.id === "joker" && !canTakeJoker(state)) return []
  const out: ShopItem[] = []
  const seen = new Set<string>()
  const key = (item: ShopItem) =>
    item.kind === "mod" ? `${item.id}:${item.letter ?? ""}` : item.id

  for (let tries = 0; tries < pack.options * 6 && out.length < pack.options; tries++) {
    let item: ShopItem | null = null
    if (pack.id === "alphabet") item = rollPairing(state, rng)
    else if (pack.id === "joker") {
      const pool = JOKERS.filter((joker) => !seen.has(joker.id)).filter(
        (joker) => !state.jokers.some((held) => held.id === joker.id),
      )
      item = pool.length > 0 ? jokerItem(pick(rng, pool)) : null
    } else {
      const category = pick(rng, CATEGORIES)
      item = { kind: "level", id: category.id, cost: LEVEL_COST }
    }
    if (!item || seen.has(key(item))) continue
    seen.add(key(item))
    out.push(item)
  }
  return out
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
 *   slot 2   upgrade: an etching group, a slice level, a category level, or a card
 *   slot 3   letter: a modifier, or a card
 *   slot 4   a pack
 * ```
 *
 * The pack gets a slot of its own rather than a share of an existing one. It is
 * the dearest thing on the shelf and the only one that asks a question back, so
 * a visit where the roll happened not to offer one would be a visit missing its
 * most interesting decision.
 *
 * Every visit now offers the same five kinds of decision. The old version rolled
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
      rollPack(state, rng),
    ],
    rerolls,
  }
}
