import { describe, expect, it } from "vitest"
import type { Action, RunState, WordSource } from "../../src/engine"
import { blindTargets, JOKER_SLOTS, reduce, startRun } from "../../src/engine"
import { realWords } from "../helpers/words"

const apply = (state: RunState, actions: Action[], words: WordSource): RunState =>
  actions.reduce((current, action) => reduce(current, action, words).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

const solve = (state: RunState, words: WordSource) => apply(state, type(state.blind.answer), words)

describe("run structure", () => {
  it("opens on ante 1, small blind, with the first target", () => {
    const state = startRun(7, realWords).state
    expect(state.ante).toBe(1)
    expect(state.blindIndex).toBe(0)
    expect(state.blind.target).toBe(blindTargets(1)[0])
    expect(state.phase).toBe("blind")
  })

  it("escalates targets across antes", () => {
    expect(blindTargets(1)).toEqual([300, 450, 600])
    expect(blindTargets(3)).toEqual([2000, 3000, 4000])
    // Geometric beyond the authored curve, and always increasing.
    for (let ante = 2; ante <= 8; ante++) {
      expect(blindTargets(ante)[0]).toBeGreaterThan(blindTargets(ante - 1)[2])
    }
  })

  it("puts a boss on the third blind only", () => {
    let state = startRun(11, realWords).state
    expect(state.blind.bossId).toBeNull()
    state = apply(solve(state, realWords), [{ type: "collect" }, { type: "next_blind" }], realWords)
    expect(state.blind.bossId).toBeNull()
    state = apply(solve(state, realWords), [{ type: "collect" }, { type: "next_blind" }], realWords)
    expect(state.blind.bossId).not.toBeNull()
  })

  it("ends the run when a blind closes below its target", () => {
    // Six guesses that never solve, against a target no plain word can reach.
    const words: WordSource = {
      answers: ["braid"],
      allowed: new Set(["arose", "braid"]),
    }
    let state = startRun(1, words).state
    for (let i = 0; i < 6; i++) state = apply(state, type("arose"), words)

    expect(state.blind.done).toBe(true)
    expect(state.blind.score).toBeLessThan(state.blind.target)
    expect(state.phase).toBe("game_over")
  })

  it("is fully determined by its seed", () => {
    const script: Action[] = [{ type: "type_letter", letter: "a" }, { type: "backspace" }]
    const a = apply(startRun(4242, realWords).state, script, realWords)
    const b = apply(startRun(4242, realWords).state, script, realWords)
    const c = startRun(4243, realWords).state

    expect(a).toEqual(b)
    expect(a.blind.answer).not.toBe(c.blind.answer)
  })

  it("survives a round trip through JSON, because saves depend on it", () => {
    const state = startRun(99, realWords).state
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it("leaves state untouched when an action is refused", () => {
    const state = startRun(5, realWords).state
    const { state: after, events } = reduce(state, { type: "buy", index: 0 }, realWords)
    expect(after).toBe(state)
    expect(events).toEqual([{ type: "rejected", reason: "not in the shop" }])
  })
})

describe("economy", () => {
  it("pays the blind, every unused guess, and interest", () => {
    const words: WordSource = { answers: ["braid"], allowed: new Set(["braid"]) }
    const state = solve(startRun(1, words).state, words)

    expect(state.phase).toBe("reward")
    // Small blind pays $3; solving on guess 1 leaves 5 guesses unused; the run
    // opens with $4, which is one $5 bracket short of any interest.
    expect(state.reward).toEqual({ base: 3, unusedGuesses: 5, interest: 0, total: 8 })
  })

  it("caps interest so hoarding is not a strategy on its own", () => {
    const words: WordSource = { answers: ["braid"], allowed: new Set(["braid"]) }
    let state = startRun(1, words).state
    state = { ...state, gold: 1000 }
    state = solve(state, words)
    expect(state.reward?.interest).toBe(5)
  })

  it("hands the reward over only when collected", () => {
    const words: WordSource = { answers: ["braid"], allowed: new Set(["braid"]) }
    const won = solve(startRun(1, words).state, words)
    const before = won.gold

    const collected = apply(won, [{ type: "collect" }], words)
    expect(collected.gold).toBe(before + 8)
    expect(collected.phase).toBe("shop")
    expect(collected.shop?.items).toHaveLength(4)
  })
})

describe("shop", () => {
  const words: WordSource = { answers: ["braid"], allowed: new Set(["braid"]) }
  const enterShop = (gold: number) => {
    let state = startRun(3, words).state
    state = { ...state, gold }
    return apply(solve(state, words), [{ type: "collect" }], words)
  }

  it("charges for a purchase and empties the slot", () => {
    const shop = enterShop(50)
    const item = shop.shop?.items[0]
    if (!item) throw new Error("expected an item")

    const after = apply(shop, [{ type: "buy", index: 0 }], words)
    expect(after.gold).toBe(shop.gold - item.cost)
    expect(after.shop?.items[0]).toBeNull()
  })

  it("refuses a purchase you cannot afford", () => {
    const shop = { ...enterShop(50), gold: 0 }
    const { state, events } = reduce(shop, { type: "buy", index: 0 }, words)
    expect(events).toEqual([{ type: "rejected", reason: "not enough gold" }])
    expect(state.gold).toBe(0)
  })

  it("refuses a sixth joker", () => {
    let state = enterShop(500)
    // Fill every slot, rerolling for fresh stock as needed.
    for (let guard = 0; guard < 40 && state.jokers.length < JOKER_SLOTS; guard++) {
      const index = state.shop?.items.findIndex((item) => item?.kind === "joker") ?? -1
      state =
        index >= 0
          ? apply(state, [{ type: "buy", index }], words)
          : apply(state, [{ type: "reroll" }], words)
    }
    expect(state.jokers).toHaveLength(JOKER_SLOTS)

    const index = state.shop?.items.findIndex((item) => item?.kind === "joker") ?? -1
    if (index >= 0) {
      const { events } = reduce(state, { type: "buy", index }, words)
      expect(events).toEqual([{ type: "rejected", reason: "no joker slots free" }])
    }
  })

  it("charges more for each reroll", () => {
    const shop = enterShop(100)
    const once = apply(shop, [{ type: "reroll" }], words)
    const twice = apply(once, [{ type: "reroll" }], words)
    expect(shop.gold - once.gold).toBe(3)
    expect(once.gold - twice.gold).toBe(4)
  })

  it("rerolls to different stock", () => {
    const shop = enterShop(100)
    const rerolled = apply(shop, [{ type: "reroll" }], words)
    expect(rerolled.shop?.items).not.toEqual(shop.shop?.items)
  })
})
