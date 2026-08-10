import { describe, expect, it } from "vitest"
import type { Action, RunState, WordSource } from "../../src/engine"
import { BOSSES, getBoss, reduce, startRun } from "../../src/engine"

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "dairy", "ghost", "arose", "guild"]),
}

const apply = (state: RunState, actions: Action[]): RunState =>
  actions.reduce((current, action) => reduce(current, action, words).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** Drops a specific boss onto the opening blind, bypassing the seeded draw. */
function underBoss(bossId: string): RunState {
  const base = startRun(1, words).state
  return {
    ...base,
    blind: {
      ...base.blind,
      bossId,
      maxGuesses: getBoss(bossId)?.maxGuesses ?? base.blind.maxGuesses,
    },
  }
}

describe("boss blinds", () => {
  it("The Silence turns yellows gray, for the eye and for the math", () => {
    // DAIRY is normally four yellows: 9 chips x 5 mult.
    const state = apply(underBoss("silence"), type("dairy"))
    expect(state.blind.guesses[0]).toMatchObject({ chips: 9, mult: 1 })
    expect(state.blind.guesses[0]?.tiles.every((tile) => tile.shown === "gray")).toBe(true)
  })

  it("The Fog hides yellows without disarming them", () => {
    const state = apply(underBoss("fog"), type("dairy"))
    const guess = state.blind.guesses[0]
    expect(guess).toMatchObject({ chips: 9, mult: 5 })
    // The mult is real; the player just cannot see where it came from.
    expect(guess?.tiles[0]).toMatchObject({ color: "yellow", shown: "gray" })
  })

  it("The Tyrant demands you keep the greens you have found", () => {
    // CRANE fixes R and A in positions 2 and 3.
    const state = apply(underBoss("tyrant"), type("crane"))
    const { events } = reduce(
      apply(state, [...[..."quazy"].map((letter): Action => ({ type: "type_letter", letter }))]),
      { type: "submit" },
      words,
    )
    expect(events).toEqual([{ type: "rejected", reason: "must keep R in position 2" }])
  })

  it("The Miser pays nothing for a letter you have already spent", () => {
    const state = apply(underBoss("miser"), [...type("crane"), ...type("crane")])
    expect(state.blind.guesses[0]?.chips).toBe(7)
    expect(state.blind.guesses[1]).toMatchObject({ chips: 0, score: 0 })
  })

  it("The Clock allows only four guesses", () => {
    let state = underBoss("clock")
    expect(state.blind.maxGuesses).toBe(4)
    for (let i = 0; i < 4; i++) state = apply(state, type("arose"))
    expect(state.blind.done).toBe(true)
    expect(state.blind.guesses).toHaveLength(4)
  })

  it("The Glutton demands two vowels", () => {
    const state = underBoss("glutton")
    const typed = apply(
      state,
      [..."ghost"].map((letter): Action => ({ type: "type_letter", letter })),
    )
    expect(reduce(typed, { type: "submit" }, words).events).toEqual([
      { type: "rejected", reason: "needs at least two vowels" },
    ])
    // GUILD has U and I, so it passes.
    expect(apply(state, type("guild")).blind.guesses).toHaveLength(1)
  })

  it("gives every boss a distinct id and some teeth", () => {
    expect(new Set(BOSSES.map((boss) => boss.id)).size).toBe(BOSSES.length)
    for (const boss of BOSSES) {
      const hasRule = Boolean(boss.maxGuesses ?? boss.transform ?? boss.validate ?? boss.tileChips)
      expect(hasRule, `${boss.id} does nothing`).toBe(true)
    }
  })
})
