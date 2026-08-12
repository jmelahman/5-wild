import { describe, expect, it } from "vitest"
import type { Action, GuessRecord, RunState, WordSource } from "../../src/engine"
import { INTEREST_CAP, JOKERS, reduce, startRun } from "../../src/engine"
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

  it("Cold Open pays the opening probe and nothing after it", () => {
    expect(withJoker("cold_open", "crane").last.chips).toBe(37)
    expect(withJoker("cold_open", "crane", "crane").last.chips).toBe(7)
  })

  it("Bloodhound pays chips per yellow", () => {
    // DAIRY lands four yellows: 9 + 24 chips.
    expect(withJoker("bloodhound", "dairy").last).toMatchObject({ chips: 33, mult: 5 })
  })

  it("Anagrammer doubles a word with five distinct letters", () => {
    expect(withJoker("anagrammer", "crane").last.mult).toBe(14)
    // SASSY repeats S three times, so it earns nothing: its lone yellow A is
    // the whole of that 2, exactly as it would be with no joker at all.
    expect(withJoker("anagrammer", "sassy").last.mult).toBe(2)
    expect(apply(startRun(1, words).state, type("sassy")).blind.guesses[0]?.mult).toBe(2)
  })

  it("Sunk Cost pays for the guesses you are about to give up", () => {
    // Guess one of six leaves five behind: +50 mult on top of CRANE's 7.
    expect(withJoker("sunk_cost", "crane").last.mult).toBe(57)
    expect(withJoker("sunk_cost", "crane", "crane").last.mult).toBe(47)
  })

  it("The Vault pays chips for stalling, the way Slow Burn pays mult", () => {
    expect(withJoker("vault", "crane").last.chips).toBe(7)
    expect(withJoker("vault", "crane", "crane").last.chips).toBe(32)
  })

  it("The Long Game buys back a point of solve multiplier", () => {
    // Solving on guess one is x6; with this it is x7, and the pile it
    // multiplies is the whole round rather than this guess.
    const { last, state } = withJoker("long_game", "braid")
    expect(last.solveBonus).toBe(7)
    expect(state.blind.score).toBe(last.score * 7)
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
      letters: { ...base.letters, q: { etch: 0, destroyed: true, mod: null } },
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

/*
 * The five that close the gaps the build rubric found. Two are terminals for
 * archetypes that previously had no way to cash in — money and sacrifice — and
 * three grow, one per lifecycle hook, which is what P1's `data` was built for.
 */
describe("the jokers that close a build", () => {
  const held = (id: string, gold: number, word: string): GuessRecord => {
    const base = startRun(1, words).state
    const state: RunState = { ...base, gold, jokers: [{ id }] }
    const last = apply(state, type(word)).blind.guesses[0]
    if (!last) throw new Error("no guess was scored")
    return last
  }

  it("The Mint turns a held pile into mult, five dollars at a time", () => {
    // CRANE is 7 x 7. At $23 that is four whole $5 steps, so +12 mult.
    expect(held("mint", 23, "crane")).toMatchObject({ chips: 7, mult: 19 })
    expect(held("mint", 4, "crane")).toMatchObject({ mult: 7 })
  })

  it("The Mint takes the interest away, which is what pays for it", () => {
    const base = startRun(1, words).state
    // Parked at the end of a cleared blind with enough gold to cap interest.
    const cleared = (jokers: RunState["jokers"]): number => {
      const state: RunState = { ...base, gold: 40, jokers, blind: { ...base.blind, target: 1 } }
      return apply(state, type("braid")).reward?.interest ?? -1
    }
    expect(cleared([])).toBe(INTEREST_CAP)
    expect(cleared([{ id: "mint" }])).toBe(0)
  })

  it("Scorched Earth pays for every letter the run has burnt", () => {
    const base = startRun(1, words).state
    const letters = { ...base.letters }
    for (const letter of "jkvwxz") letters[letter] = { etch: 0, destroyed: true, mod: null }
    const state: RunState = { ...base, letters, jokers: [{ id: "scorched_earth" }] }
    // Six burnt: 7 + 72 mult, and none of those letters is in CRANE.
    expect(apply(state, type("crane")).blind.guesses[0]).toMatchObject({ chips: 7, mult: 79 })
  })

  it("Scorched Earth is worth nothing to a run that has burnt nothing", () => {
    expect(withJoker("scorched_earth", "crane").last).toMatchObject({ mult: 7 })
  })

  it("Snowball pays what it banked, then counts the guess that grew it", () => {
    // CRANE lands two greens against BRAID. The first guess pays nothing and
    // banks +4; the second pays that 4 and banks another.
    const { state } = withJoker("snowball", "crane")
    expect(state.blind.guesses[0]).toMatchObject({ mult: 7 })
    expect(state.jokers[0]?.data).toEqual({ mult: 4 })

    const second = apply(state, type("crane")).blind.guesses[1]
    expect(second).toMatchObject({ mult: 11 })
  })

  it("Snowball survives the save round trip with its growth intact", () => {
    const { state } = withJoker("snowball", "crane")
    const revived = JSON.parse(JSON.stringify(state)) as RunState
    expect(apply(revived, type("crane")).blind.guesses[1]?.mult).toBe(11)
  })

  it("Hot Streak grows on a fast clear and not on a slow one", () => {
    const base = startRun(1, words).state
    // Target of 1, so any guess clears it; the guess count is what differs.
    const run = (probes: string[]): RunState => {
      let state: RunState = {
        ...base,
        jokers: [{ id: "hot_streak" }],
        blind: { ...base.blind, target: 1 },
      }
      for (const word of probes) state = apply(state, type(word))
      return apply(state, type("braid"))
    }
    expect(run([]).jokers[0]?.data).toEqual({ chips: 30 })
    // Four guesses to solve is past the three-guess line: nothing banked.
    expect(run(["crane", "quazy", "dairy"]).jokers[0]?.data).toBeUndefined()
  })

  it("The Hoarder grows only when both card slots are full", () => {
    const base = startRun(1, words).state
    const shopped = (consumables: RunState["consumables"]): RunState => {
      const state: RunState = {
        ...base,
        consumables,
        jokers: [{ id: "hoarder" }],
        phase: "reward",
        reward: { base: 0, unusedGuesses: 0, interest: 0, total: 0 },
      }
      return reduce(state, { type: "collect" }, words).state
    }
    expect(shopped([]).jokers[0]?.data).toBeUndefined()
    expect(shopped([{ id: "oracle" }]).jokers[0]?.data).toBeUndefined()
    expect(shopped([{ id: "oracle" }, { id: "hermit" }]).jokers[0]?.data).toEqual({ chips: 40 })
  })

  it("announces every growth, so the card visibly gets bigger", () => {
    const base = startRun(1, words).state
    const state: RunState = {
      ...base,
      jokers: [{ id: "snowball" }],
      blind: { ...base.blind, draft: "crane" },
    }
    const { events } = reduce(state, { type: "submit" }, words)
    expect(events).toContainEqual({
      type: "joker_grew",
      slot: 0,
      id: "snowball",
      label: "+4 mult",
    })
  })

  it("wears what it has grown to, so the board never has to be guessed at", () => {
    for (const id of ["snowball", "hot_streak", "hoarder"]) {
      const joker = JOKERS.find((entry) => entry.id === id)
      expect(joker?.detail, `${id} has no detail`).toBeDefined()
      expect(joker?.detail?.({ id })).toMatch(/^\+0 /)
      expect(joker?.detail?.({ id, data: { mult: 5, chips: 5 } })).toMatch(/^\+5 /)
    }
  })
})

describe("etchings", () => {
  it("raise a letter's chip value for the rest of the run", () => {
    const base = startRun(1, words).state
    // A is worth 1; etched twice it is worth 3, and CRANE holds one.
    const state: RunState = {
      ...base,
      letters: { ...base.letters, a: { etch: 2, destroyed: false, mod: null } },
    }
    expect(apply(state, type("crane")).blind.guesses[0]?.chips).toBe(9)
  })
})
