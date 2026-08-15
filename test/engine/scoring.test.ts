import { beforeEach, describe, expect, it } from "vitest"
import type { RunState, WordSource } from "../../src/engine"
import { draftChips, reduce, startRun } from "../../src/engine"

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
   *   B R A I D   GGGGG   chips  8  mult 16  ->  128
   *                                     banked  281, solve x4 -> 1124
   *
   * The solve bonus multiplies the round, not the guess that landed it, so the
   * two halves of the game compose instead of competing: QUAZY's 104 is worth
   * 416 by the end. What the player is really choosing is when to stop growing
   * the pile, because every guess spent growing it costs a point of multiplier.
   */
  it("reproduces the design doc's worked example", () => {
    let state = play(start, "quazy")
    expect(state.blind.guesses[0]).toMatchObject({ chips: 26, mult: 4, score: 104 })

    state = play(state, "crane")
    expect(state.blind.guesses[1]).toMatchObject({ chips: 7, mult: 7, score: 49 })

    // The guess records its own arithmetic; the bonus is the round's, not its.
    state = play(state, "braid")
    expect(state.blind.guesses[2]).toMatchObject({ chips: 8, mult: 16, solveBonus: 4, score: 128 })

    expect(state.blind.score).toBe((104 + 49 + 128) * 4)
    expect(state.blind.solved).toBe(true)
  })

  /*
   * The rule that pays for the whole design: solving late on a fat pile beats
   * solving early on an empty one, but only up to the point where the shrinking
   * multiplier eats the gain. Both lines below solve — one banks first.
   */
  it("multiplies everything banked this blind, not just the solving guess", () => {
    const early = play(start, "braid")
    const late = play(play(start, "quazy"), "braid")

    expect(early.blind.score).toBe(128 * 6)
    expect(late.blind.score).toBe((104 + 128) * 5)
    expect(late.blind.score).toBeGreaterThan(early.blind.score)
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

  /*
   * The live readout's promise, pinned against the thing it is a readout of.
   *
   * `draftChips` exists so the board can count a word while it is being typed,
   * and its only obligation is that the guess never comes in *under* the figure
   * the player was shown. Testing it against the real pipeline rather than
   * against arithmetic is the point: an effect added later that subtracts chips
   * would break the promise silently everywhere else, and here.
   */
  describe("the drafting readout", () => {
    const typed = (state: RunState, word: string): RunState =>
      [...word].reduce(
        (current, letter) => reduce(current, { type: "type_letter", letter }, words).state,
        state,
      )

    it("counts the letters as they are typed", () => {
      // Q, then QU, then the whole of QUAZY — 10, 11, 26.
      expect(draftChips(start, "")).toBe(0)
      expect(draftChips(start, "q")).toBe(10)
      expect(draftChips(start, "qu")).toBe(11)
      expect(draftChips(start, "quazy")).toBe(26)
    })

    it("never promises more than the guess pays", () => {
      for (const word of ["quazy", "crane", "arose", "jazzy"]) {
        const drafting = typed(start, word)
        const shown = draftChips(drafting, word)
        const paid = reduce(drafting, { type: "submit" }, words).state.blind.guesses[0]?.chips ?? 0
        expect(paid).toBeGreaterThanOrEqual(shown)
      }
    })

    it("prices the letters the way the boss in play will", () => {
      // The Drought pays nothing for vowels, and says so before the guess is
      // spent rather than after — which is the whole reason the boss hook is
      // consulted here instead of the raw letter values being summed.
      const drought = { ...start, blind: { ...start.blind, bossId: "drought" } }
      expect(draftChips(drought, "quazy")).toBe(24)
      expect(
        reduce(typed(drought, "quazy"), { type: "submit" }, words).state.blind.guesses[0],
      ).toMatchObject({ chips: 24 })
    })
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
