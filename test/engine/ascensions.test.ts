import { describe, expect, it } from "vitest"
import type { Action, RunState, WordSource } from "../../src/engine"
import {
  ASCENSIONS,
  clampAscension,
  MAX_ASCENSION,
  mustSolve,
  reduce,
  rulesFor,
  startRun,
} from "../../src/engine"
// The combined rule check is an internal seam: the reducer calls it, and this
// test needs to ask it things without playing a whole blind to get there.
import { validateGuess } from "../../src/engine/ascensions"

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "dairy", "ghost", "arose", "guild", "rabid", "acrid"]),
}

const apply = (state: RunState, actions: Action[]): RunState =>
  actions.reduce((current, action) => reduce(current, action, words).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** A run at a given level. Seed 1 draws BRAID, which every case here is about. */
const at = (ascension: number): RunState => startRun(1, words, ascension).state

/**
 * Types a word, submits it, and reports why it was refused — through the
 * reducer rather than by calling the rule, so what is under test is the rule as
 * the player meets it.
 */
function why(state: RunState, word: string): string | undefined {
  const typed = [...word].reduce(
    (current, letter) => reduce(current, { type: "type_letter", letter }, words).state,
    state,
  )
  const { events } = reduce(typed, { type: "submit" }, words)
  return events.find((event) => event.type === "rejected")?.reason
}

describe("the ladder", () => {
  it("is six linear steps, each arriving at its own level", () => {
    expect(ASCENSIONS.map((rule) => rule.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(MAX_ASCENSION).toBe(6)
    for (const rule of ASCENSIONS) {
      expect(rule.name.length, rule.name).toBeGreaterThan(0)
      expect(rule.text.length, rule.name).toBeGreaterThan(0)
    }
  })

  it("plays every rule up to the level, and none above it", () => {
    expect(rulesFor(at(0))).toHaveLength(0)
    expect(rulesFor(at(1)).map((rule) => rule.level)).toEqual([1])
    expect(rulesFor(at(4)).map((rule) => rule.level)).toEqual([1, 2, 3, 4])
    expect(rulesFor(at(MAX_ASCENSION))).toHaveLength(MAX_ASCENSION)
  })

  it("keeps a level anyone could actually be at", () => {
    expect(clampAscension(-3)).toBe(0)
    expect(clampAscension(2.7)).toBe(2)
    expect(clampAscension(99)).toBe(MAX_ASCENSION)
    expect(clampAscension(Number.NaN)).toBe(0)
    // And the run itself refuses a level off the ladder rather than storing it.
    expect(startRun(1, words, 99).state.ascension).toBe(MAX_ASCENSION)
  })

  it("costs an ordinary run nothing at all, not even a field", () => {
    // The save written by a run at ascension 0 is the file it was before any of
    // this existed, which is what makes the whole feature free for most players.
    expect(at(0).ascension).toBeUndefined()
    expect(rulesFor(at(0))).toHaveLength(0)
    expect(mustSolve(at(0))).toBe(false)
  })
})

describe("the rules themselves", () => {
  it("1 — makes you keep the letters you have found", () => {
    // AROSE against BRAID: R and A come back yellow.
    const played = apply(at(1), type("arose"))
    expect(why(played, "guild")).toBe("must use A")
    expect(why(played, "dairy")).toBeUndefined()
    // Off the ladder, the same board takes the same throwaway word.
    expect(why(apply(at(0), type("arose")), "guild")).toBeUndefined()
  })

  it("2 — refuses a word already used this blind", () => {
    const played = apply(at(2), type("crane"))
    expect(why(played, "crane")).toBe("already guessed this blind")
    expect(why(played, "ghost")).toBeUndefined()
  })

  it("3 — refuses a word used anywhere in the run", () => {
    const played = apply(at(3), type("crane"))
    expect(played.history).toEqual(["crane"])
    // Carried across a blind, which is the whole difference from rule 2: the
    // blind's own guesses are gone, the run's memory is not.
    const nextBlind: RunState = { ...played, blind: { ...at(3).blind } }
    expect(why(nextBlind, "crane")).toBe("already used this run")
  })

  it("4 — makes you keep the letters you have placed, wherever you like", () => {
    // ACRID against BRAID: A and R come back yellow, I and D land green.
    const played = apply(at(4), type("acrid"))
    // AROSE carries both yellows and neither green, so level 1 is satisfied and
    // this is the rule left to break.
    expect(why(played, "arose")).toBe("must use I")
    // DAIRY has every placed letter in it and neither of them where it was
    // placed, which is exactly what this level allows and the next will not.
    expect(why(played, "dairy")).toBeUndefined()
  })

  it("5 — makes them stay where you put them, exactly as The Tyrant does", () => {
    const played = apply(at(5), type("acrid"))
    expect(why(played, "dairy")).toBe("must keep I in position 4")
    expect(why(played, "braid")).toBeUndefined()
  })

  it("6 — is not a guess rule but a verdict on the round", () => {
    expect(mustSolve(at(6))).toBe(true)
    expect(mustSolve(at(5))).toBe(false)
    expect(ASCENSIONS[5]?.validate).toBeUndefined()
  })
})

describe("finishing the word", () => {
  const farmed = (ascension: number): RunState => {
    const base = startRun(1, words, ascension).state
    // At target, out of guesses, and the word never found: the farm-and-fail-out
    // line, which is a win everywhere except the top of the ladder.
    return {
      ...base,
      blind: { ...base.blind, target: 1, score: 500, done: false, guesses: [], maxGuesses: 1 },
    }
  }

  it("pays out a farmed blind at every level below the last", () => {
    expect(apply(farmed(5), type("ghost")).phase).toBe("reward")
  })

  it("takes the run at the last, however big the pile is", () => {
    const dead = apply(farmed(6), type("ghost"))
    expect(dead.phase).toBe("game_over")
    expect(dead.blind.score).toBeGreaterThan(dead.blind.target)
  })

  it("still pays out when the word was actually solved", () => {
    expect(apply(farmed(6), type("braid")).phase).toBe("reward")
  })
})

describe("the order of refusals", () => {
  const underGlutton = (ascension: number): RunState => {
    const base = startRun(1, words, ascension).state
    return { ...base, blind: { ...base.blind, bossId: "glutton" } }
  }

  it("answers with the run's rule before the blind's", () => {
    // GHOST breaks both at once: one vowel, and neither of the letters AROSE
    // just found. The player has to hear the same thing every time, and the
    // rule that holds every blind of the run is the one to hear about.
    const played = apply(underGlutton(1), type("arose"))
    expect(why(played, "ghost")).toBe("must use A")
  })

  it("still answers with the blind's rule when that is the only one broken", () => {
    expect(why(underGlutton(1), "ghost")).toBe("needs at least two vowels")
  })

  it("reads what happened rather than what was shown", () => {
    // The Mirror moves feedback to positions it did not come from. A rule built
    // on the board could demand a letter that is in no word at all; built on the
    // real colours, it can only ever demand letters the answer really has.
    const base = startRun(1, words, 1).state
    const under: RunState = { ...base, blind: { ...base.blind, bossId: "mirror" } }
    const played = apply(under, type("arose"))
    const shown = played.blind.guesses[0]?.tiles.map((tile) => tile.shown)
    const real = played.blind.guesses[0]?.tiles.map((tile) => tile.color)
    expect(shown).not.toEqual(real)
    // BRAID is the answer, so it satisfies a rule drawn from its own feedback —
    // whatever the board claimed.
    expect(why(played, "braid")).toBeUndefined()
  })
})

describe("the answer is always reachable", () => {
  const many: WordSource = {
    answers: ["braid", "crane", "ghost", "dairy", "arose", "guild"],
    allowed: new Set(["braid", "crane", "ghost", "dairy", "arose", "guild"]),
  }

  it("never deals a word the run is forbidden to type", () => {
    // Ascension 3 forbids repeating a word, so a blind whose answer has already
    // been guessed is a blind that cannot be solved — and at ascension 6 that is
    // a blind that cannot be won at all. The pool has to know that.
    const base = startRun(4, many, MAX_ASCENSION).state
    const used = many.answers.filter((word) => word !== "guild")
    const state: RunState = { ...base, history: used, ante: 1, blindIndex: 1 }
    // Dealt through the real path — the shop left behind and the next blind
    // begun, which is the only route that redraws an answer.
    const played = reduce({ ...state, phase: "shop", shop: null }, { type: "next_blind" }, many)
    expect(used).not.toContain(played.state.blind.answer)
    expect(played.state.blind.answer).toBe("guild")
  })

  it("hands every rule a board its own answer satisfies", () => {
    // The property the whole design rests on: rules read real feedback, so the
    // answer always passes them. Played out over a full blind at the top of the
    // ladder rather than argued about.
    let state = startRun(9, many, MAX_ASCENSION).state
    const answer = state.blind.answer
    for (const guess of ["crane", "ghost", "arose"]) {
      if (guess === answer) continue
      expect(validateGuess(answer, state), `after ${guess}`).toBeNull()
      const next = apply(state, type(guess))
      if (next.phase !== "blind") break
      state = next
    }
    expect(validateGuess(answer, state)).toBeNull()
  })
})

describe("what a run carries", () => {
  it("writes down every word it has said, whatever the level", () => {
    const played = apply(at(0), [...type("crane"), ...type("ghost")])
    expect(played.history).toEqual(["crane", "ghost"])
  })

  it("stays plain JSON with the ladder on it", () => {
    const played = apply(at(MAX_ASCENSION), type("crane"))
    expect(JSON.parse(JSON.stringify(played))).toEqual(played)
  })

  it("starts a run at the level the action asked for", () => {
    const { state } = reduce(at(0), { type: "start_run", seed: 3, ascension: 4 }, words)
    expect(state.ascension).toBe(4)
    // And omits it entirely when nobody asked for one.
    expect(reduce(at(0), { type: "start_run", seed: 3 }, words).state.ascension).toBeUndefined()
  })
})
