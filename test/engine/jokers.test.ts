import { describe, expect, it } from "vitest"
import type { Action, GuessRecord, RunState, WordSource } from "../../src/engine"
import { JOKERS, reduce, startRun } from "../../src/engine"
import { realWords } from "../helpers/words"

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "dairy", "ghost", "sassy", "arose"]),
}

const apply = (state: RunState, actions: Action[], source = words): RunState =>
  actions.reduce((current, action) => reduce(current, action, source).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** Plays one guess with a joker equipped and hands back the scored record. */
function withJoker(id: string, ...guesses: string[]): { last: GuessRecord; state: RunState } {
  const base = startRun(1, words).state
  let state: RunState = { ...base, jokers: [{ id }] }
  for (const word of guesses) state = apply(state, type(word))
  const last = state.blind.guesses[state.blind.guesses.length - 1]
  if (!last) throw new Error("no guess was scored")
  return { last, state }
}

describe("jokers", () => {
  // Baselines, so every expectation below reads as a delta rather than a magic
  // number: CRANE is 7 chips x 7 mult, QUAZY is 26 x 4.
  it("scores nothing extra with no jokers", () => {
    const base = startRun(1, words).state
    const state = apply(base, type("crane"))
    expect(state.blind.guesses[0]).toMatchObject({ chips: 7, mult: 7, score: 49 })
  })

  it("Green Thumb pays 8 chips per green", () => {
    // CRANE lands two greens: 7 + 16 chips.
    expect(withJoker("green_thumb", "crane").last).toMatchObject({ chips: 23, mult: 7 })
  })

  it("Vowel Hoarder pays 4 mult per vowel", () => {
    // A and E: 7 + 8 mult.
    expect(withJoker("vowel_hoarder", "crane").last).toMatchObject({ chips: 7, mult: 15 })
  })

  it("Greedy Grammarian pays 15 chips per gray", () => {
    // QUAZY leaves four grays: 26 + 60 chips.
    expect(withJoker("greedy_grammarian", "quazy").last).toMatchObject({ chips: 86, mult: 4 })
  })

  it("Masochist pays 8 mult per gray", () => {
    expect(withJoker("masochist", "quazy").last).toMatchObject({ chips: 26, mult: 36 })
  })

  it("Q's Bargain triples the rare letters", () => {
    // Q and Z are 10 each, so each adds another 20.
    expect(withJoker("qs_bargain", "quazy").last).toMatchObject({ chips: 66, mult: 4 })
  })

  it("Doppelgänger scores repeated letters twice", () => {
    // SASSY: three Ss at 1 chip each pay again.
    expect(withJoker("doppelganger", "sassy").last.chips).toBe(11)
  })

  it("Alphabetist doubles an in-order word", () => {
    // GHOST is non-decreasing and misses entirely: 9 chips, mult 1 doubled.
    expect(withJoker("alphabetist", "ghost").last).toMatchObject({ chips: 9, mult: 2 })
  })

  it("Consonant Cluster wants three consonants in a row", () => {
    // SASSY ends S-S-Y and lands a single yellow: mult 2, then x1.5.
    expect(withJoker("consonant_cluster", "sassy").last.mult).toBe(3)
    expect(withJoker("consonant_cluster", "crane").last.mult).toBe(7) // no run, untouched
  })

  it("Slow Burn pays for stalling", () => {
    expect(withJoker("slow_burn", "crane").last.mult).toBe(7)
    expect(withJoker("slow_burn", "crane", "crane").last.mult).toBe(12)
  })

  it("Speedrunner triples a fast solve", () => {
    const { last } = withJoker("speedrunner", "braid")
    expect(last).toMatchObject({ chips: 8, mult: 48, solveBonus: 6 })
  })

  it("Speedrunner does nothing on a slow one", () => {
    const { last } = withJoker("speedrunner", "crane", "crane", "crane", "braid")
    expect(last.mult).toBe(16)
  })

  it("Scavenger pays gold per yellow", () => {
    const { state } = withJoker("scavenger", "dairy")
    expect(state.gold).toBe(startRun(1, words).state.gold + 4)
  })

  it("Pyromaniac burns a letter out of the alphabet, and the answer respects it", () => {
    // Needs a real blind transition, since burning happens before the draw.
    let state = startRun(1, realWords).state
    state = apply(state, type(state.blind.answer), realWords)
    state = apply(state, [{ type: "collect" }], realWords)
    state = { ...state, jokers: [{ id: "pyromaniac" }] }
    state = apply(state, [{ type: "next_blind" }], realWords)

    const burnt = Object.entries(state.letters)
      .filter(([, letter]) => letter.destroyed)
      .map(([name]) => name)

    expect(burnt).toHaveLength(1)
    expect(state.blind.answer).not.toContain(burnt[0])
  })

  it("refuses to type a burnt letter", () => {
    const base = startRun(1, words).state
    const state: RunState = {
      ...base,
      letters: { ...base.letters, q: { etch: 0, destroyed: true } },
    }
    const { events } = reduce(state, { type: "type_letter", letter: "q" }, words)
    expect(events).toEqual([{ type: "rejected", reason: "Q is burnt out" }])
  })

  it("gives every joker a distinct id, name and price", () => {
    expect(new Set(JOKERS.map((joker) => joker.id)).size).toBe(JOKERS.length)
    expect(new Set(JOKERS.map((joker) => joker.name)).size).toBe(JOKERS.length)
    for (const joker of JOKERS) expect(joker.cost).toBeGreaterThan(0)
  })
})

describe("etchings", () => {
  it("raise a letter's chip value for the rest of the run", () => {
    const base = startRun(1, words).state
    // A is worth 1; etched twice it is worth 3, and CRANE holds one.
    const state: RunState = {
      ...base,
      letters: { ...base.letters, a: { etch: 2, destroyed: false } },
    }
    expect(apply(state, type("crane")).blind.guesses[0]?.chips).toBe(9)
  })
})
