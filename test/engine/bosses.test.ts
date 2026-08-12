import { describe, expect, it } from "vitest"
import type { Action, RunState, WordSource } from "../../src/engine"
import {
  ANTES,
  BOSSES,
  bossesIn,
  getBoss,
  LETTER_CHIPS,
  reduce,
  solveBonusFor,
  startRun,
  tierForAnte,
} from "../../src/engine"
// Not part of the engine's public surface — the draw is an internal detail that
// only the ante loop and this test have any business calling.
import { bossForAnte } from "../../src/engine/bosses"

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "dairy", "ghost", "arose", "guild", "jazzy"]),
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

  it("The Auditor caps the cash-out, so the build has to carry the blind", () => {
    // Solving on guess one is normally worth x6. Under The Auditor it is worth
    // x2, and the pile it multiplies has to have been earned rather than timed.
    const normal = apply(startRun(1, words).state, type("braid"))
    const audited = apply(underBoss("auditor"), type("braid"))
    expect(normal.blind.score).toBe(audited.blind.score * 3)
    expect(solveBonusFor(underBoss("auditor"), 5)).toBe(2)
  })

  /*
   * The doubled letter is what makes JAZZY worth 34 chips and almost no
   * information, so this is the boss that takes the chip build's best line away
   * without touching deduction. That its answers stay typeable is covered by
   * the full-run test, which walks every boss across 120 seeds.
   */
  it("The Purist forbids repeated letters", () => {
    const state = underBoss("purist")
    const typed = apply(state, type("jazzy").slice(0, -1))
    expect(reduce(typed, { type: "submit" }, words).events).toEqual([
      { type: "rejected", reason: "no repeated letters" },
    ])
    expect(apply(state, type("braid")).blind.guesses).toHaveLength(1)
  })

  it("gives every boss a distinct id and some teeth", () => {
    expect(new Set(BOSSES.map((boss) => boss.id)).size).toBe(BOSSES.length)
    for (const boss of BOSSES) {
      const hasRule = Boolean(
        boss.maxGuesses ?? boss.transform ?? boss.validate ?? boss.tileChips ?? boss.solveBonus,
      )
      expect(hasRule, `${boss.id} does nothing`).toBe(true)
    }
  })

  it("The Drought refuses to pay for vowels", () => {
    // AROSE is A-R-O-S-E: three vowels worth nothing, two consonants that still
    // score. The Glutton, in the same band, demands the letters this one voids.
    const state = apply(underBoss("drought"), type("arose"))
    const consonants = (LETTER_CHIPS.r ?? 0) + (LETTER_CHIPS.s ?? 0)
    expect(state.blind.guesses[0]?.chips).toBe(consonants)
  })

  it("The Mirror reverses what you see and nothing else", () => {
    const state = apply(underBoss("mirror"), type("dairy"))
    const plain = apply(startRun(1, words).state, type("dairy"))
    const guess = state.blind.guesses[0]
    // Identical arithmetic, reversed reading.
    expect(guess).toMatchObject({ chips: plain.blind.guesses[0]?.chips, mult: 5 })
    expect(guess?.tiles.map((tile) => tile.shown)).toEqual(
      plain.blind.guesses[0]?.tiles.map((tile) => tile.shown).reverse(),
    )
    expect(guess?.tiles.map((tile) => tile.color)).toEqual(
      plain.blind.guesses[0]?.tiles.map((tile) => tile.color),
    )
  })

  it("The Famine allows only three guesses", () => {
    let state = underBoss("famine")
    expect(state.blind.maxGuesses).toBe(3)
    for (let i = 0; i < 3; i++) state = apply(state, type("arose"))
    expect(state.blind.done).toBe(true)
  })

  it("The Rust pays a letter what it started as, whatever was etched on it", () => {
    const base = underBoss("rust")
    const etched: RunState = {
      ...base,
      letters: { ...base.letters, a: { etch: 50, destroyed: false, mod: null } },
    }
    expect(apply(etched, type("braid")).blind.guesses[0]?.chips).toBe(
      apply(base, type("braid")).blind.guesses[0]?.chips,
    )
  })

  it("gives every boss a band, and every band enough bosses to fill its antes", () => {
    for (const tier of ["early", "mid", "late"] as const) {
      const band = bossesIn(tier)
      const antes = Array.from({ length: ANTES }, (_, i) => i + 1).filter(
        (ante) => tierForAnte(ante) === tier,
      )
      // A band with fewer bosses than antes would have to repeat one, which is
      // the property the old flat draw guaranteed and this one has to earn.
      expect(band.length, `${tier} band is short`).toBeGreaterThanOrEqual(antes.length)
    }
    expect(bossesIn("early").length + bossesIn("mid").length + bossesIn("late").length).toBe(
      BOSSES.length,
    )
  })

  /*
   * What replaced "every boss exactly once". A run no longer meets all of them
   * — that is the point of banding — but it must still never meet one twice,
   * and must never meet a late boss early. Both are checked across many seeds
   * because a single seed could pass by luck.
   */
  it("never repeats a boss, and never shows one out of its band", () => {
    const base = startRun(1, words).state
    for (let seed = 1; seed <= 120; seed++) {
      const seen = new Set<string>()
      for (let ante = 1; ante <= ANTES; ante++) {
        const id = bossForAnte({ ...base, seed, ante })
        expect(seen.has(id), `seed ${seed} repeated ${id}`).toBe(false)
        seen.add(id)
        expect(getBoss(id)?.tier).toBe(tierForAnte(ante))
      }
    }
  })

  it("draws a different set from run to run, which banding is what buys", () => {
    const base = startRun(1, words).state
    const runs = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const ids = Array.from({ length: ANTES }, (_, i) =>
        bossForAnte({ ...base, seed, ante: i + 1 }),
      )
      runs.add(ids.join(","))
    }
    // The old draw produced one sequence per permutation of all eight; this one
    // also varies *which* bosses appear at all. Anything close to 1 would mean
    // the band streams had collapsed onto the same order.
    expect(runs.size).toBeGreaterThan(30)
  })
})
