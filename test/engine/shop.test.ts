import { describe, expect, it } from "vitest"
import type { Action, RunState } from "../../src/engine"
import {
  ALPHABET,
  derive,
  ETCHING_BY_ID,
  ETCHINGS,
  JOKERS,
  reduce,
  startRun,
} from "../../src/engine"
import { rollShop } from "../../src/engine/shop"
import { realWords } from "../helpers/words"

const shopAt = (seed: number, ante = 1) =>
  rollShop(startRun(seed, realWords).state, derive(seed, "shop", ante, 0, 0), 0)

/** A run parked in the shop with plenty of gold, so buying is never rejected. */
function inShop(seed: number): RunState {
  const base = startRun(seed, realWords).state
  return { ...base, phase: "shop", gold: 999, shop: shopAt(seed) }
}

const buy = (state: RunState, index: number): RunState =>
  reduce(state, { type: "buy", index } satisfies Action, realWords).state

/** Puts a specific etching in slot 0, whatever the roll happened to deal. */
function offering(state: RunState, id: string): RunState {
  const etching = ETCHING_BY_ID.get(id)
  if (!etching) throw new Error(`no etching ${id}`)
  return {
    ...state,
    shop: { items: [{ kind: "etch", id, cost: etching.cost }], rerolls: 0 },
  }
}

describe("the shop layout", () => {
  it("always deals two jokers and never a third", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const kinds = shopAt(seed).items.map((item) => item?.kind)
      expect(kinds.slice(0, 2)).toEqual(["joker", "joker"])
      expect(kinds.filter((kind) => kind === "joker")).toHaveLength(2)
    }
  })

  it("never deals the same joker twice", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [first, second] = shopAt(seed).items
      expect(first?.kind === "joker" && second?.kind === "joker" && first.id === second.id).toBe(
        false,
      )
    }
  })

  it("keeps the upgrade and letter slots to their own stock", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const items = shopAt(seed).items
      expect(["etch", "consumable"]).toContain(items[2]?.kind)
      expect(["mod", "consumable"]).toContain(items[3]?.kind)
    }
  })

  it("fills the joker slots with ordinary stock once every joker is owned", () => {
    const base = startRun(3, realWords).state
    const state: RunState = { ...base, jokers: JOKERS.map((joker) => ({ id: joker.id })) }
    const items = rollShop(state, derive(3, "shop", 1, 0, 0), 0).items
    expect(items).toHaveLength(4)
    expect(items.map((item) => item?.kind)).not.toContain("joker")
    for (const item of items) expect(item).not.toBeNull()
  })

  it("stops offering an etching whose group is entirely burnt out", () => {
    const base = startRun(5, realWords).state
    const letters = { ...base.letters }
    for (const letter of "jqxz") letters[letter] = { etch: 0, destroyed: true, mod: null }
    const state: RunState = { ...base, letters }
    // Every roll of the upgrade slot, across many streams: Heavy is unsellable
    // because there is nothing left in it to etch.
    for (let ante = 1; ante <= 40; ante++) {
      const item = rollShop(state, derive(5, "shop", ante, 0, 0), 0).items[2]
      if (item?.kind === "etch") expect(item.id).not.toBe("etch_heavy")
    }
  })
})

describe("group etchings", () => {
  it("raises every letter in the group at once", () => {
    const state = buy(offering(inShop(1), "etch_vowels"), 0)
    for (const letter of "aeiou") expect(state.letters[letter]?.etch).toBe(2)
    for (const letter of "lnstr") expect(state.letters[letter]?.etch).toBe(0)
  })

  it("stacks, because that is the whole idea", () => {
    let state = inShop(1)
    for (let bought = 0; bought < 3; bought++) state = buy(offering(state, "etch_vowels"), 0)
    expect(state.letters.a?.etch).toBe(6)
  })

  it("skips a letter that has already burnt out", () => {
    const base = inShop(1)
    const state = buy(
      offering(
        { ...base, letters: { ...base.letters, e: { etch: 0, destroyed: true, mod: null } } },
        "etch_vowels",
      ),
      0,
    )
    expect(state.letters.e?.etch).toBe(0)
    expect(state.letters.a?.etch).toBe(2)
  })

  it("covers every consonant and no vowel", () => {
    const state = buy(offering(inShop(1), "etch_consonants"), 0)
    const etched = [...ALPHABET].filter((letter) => (state.letters[letter]?.etch ?? 0) > 0)
    expect(etched.join("")).toBe("bcdfghjklmnpqrstvwxyz")
  })

  it("charges for the group and leaves the slot sold", () => {
    const state = buy(offering({ ...inShop(1), gold: 10 }, "etch_heavy"), 0)
    expect(state.gold).toBe(10 - 5)
    expect(state.shop?.items[0]).toBeNull()
  })

  it("refuses a group it does not recognise, without taking the gold", () => {
    const state = inShop(1)
    const stale: RunState = {
      ...state,
      gold: 20,
      shop: { items: [{ kind: "etch", id: "etch_letter_a", cost: 4 }], rerolls: 0 },
    }
    const { state: after, events } = reduce(stale, { type: "buy", index: 0 }, realWords)
    expect(after.gold).toBe(20)
    expect(events).toContainEqual({ type: "rejected", reason: "unknown etching" })
  })

  it("prices breadth against depth rather than under it", () => {
    // The bug this replaced: $4 bought one chip on one letter, while $4 bought
    // twenty on one letter from the modifier line. Every group now buys at least
    // eight chips' worth of alphabet, so none of them is a wasted slot.
    for (const etching of ETCHINGS) {
      expect(etching.chips * etching.letters.length).toBeGreaterThanOrEqual(8)
      expect(etching.cost).toBeGreaterThan(4)
    }
  })
})
