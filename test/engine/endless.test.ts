import { describe, expect, it } from "vitest"
import type { Action, RunState, WordSource } from "../../src/engine"
import { ANTES, blindTargets, derive, getBoss, reduce, startRun } from "../../src/engine"
// Not public surface: the shop roll and the boss draw are internals, and this
// test needs them to say *which* shop and *which* boss, not merely that there is
// one.
import { bossForAnte } from "../../src/engine/bosses"
import { rollShop } from "../../src/engine/shop"

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "ghost", "audio"]),
}

const apply = (state: RunState, actions: Action[]): RunState =>
  actions.reduce((current, action) => reduce(current, action, words).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** A run standing on the reward for a given blind, with the win still to come. */
function atReward(ante: number, blindIndex: 0 | 1 | 2, won = false): RunState {
  const base = startRun(7, words).state
  return {
    ...base,
    ante,
    blindIndex,
    // Spread rather than `won: undefined` — the field is absent on a run that
    // has not won, and `exactOptionalPropertyTypes` holds us to the difference.
    ...(won ? { won: true } : {}),
    phase: "reward",
    reward: { base: 5, unusedGuesses: 0, interest: 0, total: 5 },
  }
}

describe("winning the run", () => {
  it("offers the win at the end of the last ante rather than taking it", () => {
    const { state, events } = reduce(atReward(ANTES, 2), { type: "collect" }, words)
    expect(state.phase).toBe("victory")
    expect(state.won).toBe(true)
    expect(events.some((event) => event.type === "run_won")).toBe(true)
    // The reward is still banked. Winning is not a reason to be short-changed.
    expect(state.gold).toBe(startRun(7, words).state.gold + 5)
  })

  it("does not offer it early, or on any other blind of the last ante", () => {
    for (const blindIndex of [0, 1] as const) {
      expect(reduce(atReward(ANTES, blindIndex), { type: "collect" }, words).state.phase).toBe(
        "shop",
      )
    }
    expect(reduce(atReward(ANTES - 1, 2), { type: "collect" }, words).state.phase).toBe("shop")
  })

  it("refuses to continue a run that has not won", () => {
    for (const state of [startRun(7, words).state, atReward(ANTES, 2)]) {
      const { events } = reduce(state, { type: "continue_run" }, words)
      expect(events).toContainEqual({ type: "rejected", reason: "the run is not won" })
    }
  })
})

describe("playing on past the win", () => {
  const won = reduce(atReward(ANTES, 2), { type: "collect" }, words).state

  it("hands back the shop the victory screen was shown instead of", () => {
    const state = apply(won, [{ type: "continue_run" }])
    expect(state.phase).toBe("shop")
    // Not merely *a* shop: the one those coordinates were always going to roll.
    // The win is a screen held in front of the ordinary loop, not a detour
    // around it, so continuing cannot deal a different stock than banking and
    // playing on would have.
    expect(state.shop).toEqual(rollShop(won, derive(won.seed, "shop", ANTES, 2, 0), 0))
  })

  it("carries the run into antes nobody authored", () => {
    const state = apply(won, [{ type: "continue_run" }, { type: "next_blind" }])
    expect(state.ante).toBe(ANTES + 1)
    expect(state.blindIndex).toBe(0)
    expect(state.phase).toBe("blind")
    expect(state.blind.target).toBe(blindTargets(ANTES + 1)[0])
    expect(state.blind.target).toBeGreaterThan(blindTargets(ANTES)[0])
  })

  it("keeps dealing bosses out there, from the band the antes belong to", () => {
    // `bossForAnte` wraps within a band rather than running out, so ante 40 is
    // as ordinary a boss blind as ante 8 — it just repeats one seen before.
    for (let ante = ANTES + 1; ante <= ANTES + 12; ante++) {
      const boss = getBoss(bossForAnte({ ...won, ante }))
      expect(boss, `ante ${ante}`).toBeDefined()
      expect(boss?.tier).toBe("late")
    }
  })

  it("offers the win exactly once, however far the run goes", () => {
    // Every third blind from here is the last blind of an ante at or past
    // `ANTES`, and the gate that offered the win reads exactly that. Without
    // `won` holding it shut, the ending would arrive again every ante.
    for (const ante of [ANTES, ANTES + 1, ANTES + 7]) {
      const { state, events } = reduce(atReward(ante, 2, true), { type: "collect" }, words)
      expect(state.phase, `ante ${ante}`).toBe("shop")
      expect(events.some((event) => event.type === "run_won")).toBe(false)
    }
  })

  it("keeps the win when the endless antes finally kill it", () => {
    const base = startRun(7, words).state
    const doomed: RunState = {
      ...base,
      won: true,
      ante: ANTES + 4,
      phase: "blind",
      blind: { ...base.blind, answer: "braid", target: 999_999, maxGuesses: 1 },
    }
    const dead = apply(doomed, type("crane"))
    expect(dead.phase).toBe("game_over")
    // The run beat the game. What happened after it does not take that back —
    // and the end screen says both things because of this flag.
    expect(dead.won).toBe(true)
  })

  it("stays plain JSON with the flag on it", () => {
    const state = apply(won, [{ type: "continue_run" }, { type: "next_blind" }])
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
