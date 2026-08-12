import { ALPHABET } from "../content/letters"
import { CONSUMABLES } from "./consumables"
import { JOKERS } from "./jokers"
import type { ModId } from "./modifiers"
import { MODIFIER_BY_ID } from "./modifiers"
import type { Rng } from "./rng"
import { pick, shuffled } from "./rng"
import type { RunState, ShopItem, ShopState } from "./state"

export const SHOP_SLOTS = 4
export const ETCH_COST = 4
const BASE_REROLL = 3

export const rerollCost = (shop: ShopState): number => BASE_REROLL + shop.rerolls

/** Half price, rounded down, never nothing. */
export const sellValue = (cost: number): number => Math.max(1, Math.floor(cost / 2))

/**
 * Weighted so jokers dominate — they are the biggest permanent build decision —
 * while etchings give a cheap outlet for spare gold late in a run when every
 * joker on offer is already owned.
 */
const ROLL_TABLE = ["joker", "joker", "consumable", "mod", "etch"] as const

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

/** Jokers already owned are off the table — duplicates do not stack. */
const unowned = (state: RunState) => {
  const owned = new Set(state.jokers.map((instance) => instance.id))
  return JOKERS.filter((joker) => !owned.has(joker.id))
}

/** Falls back to an ordinary roll only once every joker is already owned. */
function rollJoker(state: RunState, rng: Rng): ShopItem {
  const available = unowned(state)
  const joker = available.length > 0 ? pick(rng, available) : null
  return joker ? { kind: "joker", id: joker.id, cost: joker.cost } : rollItem(state, rng)
}

function rollItem(state: RunState, rng: Rng): ShopItem {
  const available = unowned(state)
  const kind = pick(rng, ROLL_TABLE)

  if (kind === "joker" && available.length > 0) {
    const joker = pick(rng, available)
    return { kind: "joker", id: joker.id, cost: joker.cost }
  }

  if (kind === "mod") {
    const item = rollMod(state, rng)
    if (item) return item
  }

  if (kind === "etch" || available.length === 0) {
    const alive = [...ALPHABET].filter((letter) => !state.letters[letter]?.destroyed)
    if (alive.length > 0) return { kind: "etch", letter: pick(rng, alive), cost: ETCH_COST }
  }

  const card = pick(rng, CONSUMABLES)
  return { kind: "consumable", id: card.id, cost: card.cost }
}

export function rollShop(state: RunState, rng: Rng, rerolls: number): ShopState {
  // Deal distinct items where possible: two identical jokers in one shop reads
  // as a bug even when it is only luck.
  const items: ShopItem[] = []
  const seen = new Set<string>()
  for (let attempt = 0; attempt < SHOP_SLOTS * 6 && items.length < SHOP_SLOTS; attempt++) {
    // The first slot is always a joker when one is left to sell. Four etchings
    // is a legal roll and a dead shop: every visit should offer one real build
    // decision, even if the player cannot afford it.
    const item = items.length === 0 ? rollJoker(state, rng) : rollItem(state, rng)
    // Keyed by the letter for both letter-shaped items, so one shop never sells
    // two things that land on the same key.
    const key =
      item.kind === "etch" || item.kind === "mod"
        ? `letter:${item.letter}`
        : `${item.kind}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  while (items.length < SHOP_SLOTS) {
    const letter = shuffled(rng, [...ALPHABET])[0] ?? "e"
    items.push({ kind: "etch", letter, cost: ETCH_COST })
  }
  return { items, rerolls }
}
