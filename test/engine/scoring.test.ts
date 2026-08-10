import { beforeEach, describe, expect, it } from "vitest"
import type { RunState, WordSource } from "../../src/engine"
import { reduce, startRun } from "../../src/engine"

/**
 * A word source narrow enough that the answer is known in advance. The engine
 * takes its word lists as an argument precisely so tests can do this.
 */
const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "dairy", "jazzy", "arose", "aloes", "zonks"]),
}

const play = (state: RunState, word: string): RunState => {
  let current = state
  for (const letter of word) current = reduce(current, { type: "type_letter", letter }, words).state
  return reduce(current, { type: "submit" }, words).state
}

describe("guess scoring", () => {
  let start: RunState

  beforeEach(() => {
    start = startRun(1, words).state
  })

  it("draws the answer from the supplied list", () => {
    expect(start.blind.answer).toBe("braid")
  })

  /**
   * The worked example from the design doc, played end to end.
   *
   *   Q U A Z Y   ..G..   chips 26  mult  4  ->  104
   *   C R A N E   .GG..   chips  7  mult  7  ->   49
   *   B R A I D   GGGGG   chips  8  mult 16  ->  128, solve x4 -> 512
   *                                              total 665
   *
   * QUAZY is a deliberately terrible deduction guess that banks more than
   * double what the excellent CRANE earns — but the solve on guess three
   * carries 77% of the round. That ratio is the whole game.
   */
  it("reproduces the design doc's worked example", () => {
    let state = play(start, "quazy")
    expect(state.blind.guesses[0]).toMatchObject({ chips: 26, mult: 4, score: 104 })

    state = play(state, "crane")
    expect(state.blind.guesses[1]).toMatchObject({ chips: 7, mult: 7, score: 49 })

    state = play(state, "braid")
    expect(state.blind.guesses[2]).toMatchObject({ chips: 8, mult: 16, solveBonus: 4, score: 512 })

    expect(state.blind.score).toBe(665)
    expect(state.blind.solved).toBe(true)
  })

  it("builds mult from the feedback: 1 + 3 per green + 1 per yellow", () => {
    const state = play(start, "dairy")
    // Four yellows, no greens.
    expect(state.blind.guesses[0]?.mult).toBe(5)
  })

  it("values rare letters far above common ones", () => {
    // The tension in one assertion: QUAZY banks five times the chips of AROSE
    // while telling you almost nothing, and AROSE is the better probe.
    expect(play(start, "quazy").blind.guesses[0]?.chips).toBe(26)
    expect(play(start, "arose").blind.guesses[0]?.chips).toBe(5)
  })

  it("ends the blind the moment the word is solved, forfeiting the rest", () => {
    const state = play(start, "braid")
    expect(state.blind.done).toBe(true)
    expect(state.blind.guesses).toHaveLength(1)
    // Solved on guess 1 of 6: five guesses remain, so the bonus is x6.
    expect(state.blind.guesses[0]?.solveBonus).toBe(6)
  })

  it("shrinks the solve bonus the longer you take", () => {
    const bonuses = ["quazy", "crane", "dairy", "arose", "aloes"].map((_, index) => {
      let state = start
      for (let i = 0; i < index; i++) {
        state = play(state, ["quazy", "crane", "dairy", "arose", "aloes"][i] as string)
      }
      return play(state, "braid").blind.guesses[index]?.solveBonus
    })
    expect(bonuses).toEqual([6, 5, 4, 3, 2])
  })

  it("rejects a word that is not in the allowed list", () => {
    let state = start
    for (const letter of "zzzzz") {
      state = reduce(state, { type: "type_letter", letter }, words).state
    }
    const { state: after, events } = reduce(state, { type: "submit" }, words)
    expect(events).toEqual([{ type: "rejected", reason: "not in word list" }])
    expect(after.blind.guesses).toHaveLength(0)
    expect(after.blind.draft).toBe("zzzzz")
  })
})
