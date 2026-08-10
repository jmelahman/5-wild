import { describe, expect, it } from "vitest"
import type { Action, RunState } from "../../src/engine"
import { ANTES, blindTargets, getBoss, reduce, startRun } from "../../src/engine"
import { realWords } from "../helpers/words"

const words = realWords

const apply = (state: RunState, actions: Action[]): RunState =>
  actions.reduce((current, action) => reduce(current, action, words).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/**
 * A bot that plays the greedy-solve line: guess the answer immediately for the
 * maximum solve bonus, then spend everything on the first thing it can afford.
 * It is not a good player — it never farms chips — but it is a complete one,
 * and it proves the loop runs start to finish without a screen attached.
 */
function playRun(seed: number): {
  state: RunState
  blindsCleared: number
  illegal: string[]
  misplacedBosses: string[]
} {
  let state = startRun(seed, words).state
  let blindsCleared = 0
  const illegal: string[] = []
  const misplacedBosses: string[] = []

  // 24 blinds is a full win; the cap is a runaway guard, not an expectation.
  for (let step = 0; step < 200; step++) {
    if (state.phase === "game_over" || state.phase === "victory") break

    if (state.phase === "blind") {
      if ((state.blind.bossId !== null) !== (state.blindIndex === 2)) {
        misplacedBosses.push(
          `ante ${state.ante} blind ${state.blindIndex}: ${state.blind.bossId ?? "none"}`,
        )
      }
      const refusal = getBoss(state.blind.bossId)?.validate?.(state.blind.answer, state.blind)
      if (refusal) {
        illegal.push(`${state.blind.bossId}/${state.blind.answer}: ${refusal}`)
        break
      }
      state = apply(state, type(state.blind.answer))
      continue
    }
    if (state.phase === "reward") {
      blindsCleared++
      state = apply(state, [{ type: "collect" }])
      continue
    }
    if (state.phase === "shop") {
      const index = state.shop?.items.findIndex((item) => item && item.cost <= state.gold) ?? -1
      if (index < 0) {
        state = apply(state, [{ type: "next_blind" }])
        continue
      }
      // A buy can be refused — full joker slots, full card slots — and a bot
      // that cannot tell that from a purchase will shop forever.
      const attempt = reduce(state, { type: "buy", index }, words)
      const refused = attempt.events.some((event) => event.type === "rejected")
      state = refused ? apply(state, [{ type: "next_blind" }]) : attempt.state
    }
  }

  return { state, blindsCleared, illegal, misplacedBosses }
}

describe("a full run, headless", () => {
  it("always terminates in a decided state", () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const { state } = playRun(seed)
      expect(["game_over", "victory"]).toContain(state.phase)
    }
  })

  /*
   * The blind must always be winnable. The Glutton demands two vowels of every
   * guess and a fifth of the answer list has one, so an unfiltered draw hands
   * the player a word they are forbidden to type — a blind that cannot be
   * solved by any play. Pyromaniac makes this worse: burning enough letters can
   * empty the pool, and the escape hatch that heals the alphabet must not also
   * drop the boss rule on its way out.
   */
  it("never draws an answer its own boss forbids", () => {
    const illegal = Array.from({ length: 120 }, (_, seed) => playRun(seed + 1).illegal).flat()
    expect(illegal).toEqual([])
  })

  /*
   * The ante's shape is Small → Big → Boss, and the boss rule is a large part
   * of a blind's difficulty. A boss leaking onto blind 0 or 1 — or missing from
   * blind 2 — silently rewrites the difficulty curve without failing anything
   * else, so the placement is asserted rather than assumed.
   */
  it("puts a boss on the third blind of an ante and nowhere else", () => {
    const misplaced = Array.from({ length: 40 }, (_, seed) => playRun(seed + 1).misplacedBosses)
    expect(misplaced.flat()).toEqual([])
  })

  it("never leaves the state un-serialisable, whatever it accumulated", () => {
    const { state } = playRun(2024)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it("is reproducible from the seed alone", () => {
    expect(playRun(31337).state).toEqual(playRun(31337).state)
  })

  /*
   * Not a balance assertion — a tripwire. The greedy-solve line clears a
   * handful of blinds and then hits the target curve, which is expected until
   * the Phase 6 simulator tunes it. If this number moves a long way in either
   * direction, the curve or the scoring changed and someone should know.
   */
  it("gets a greedy solver a few blinds in, and no further", () => {
    const cleared = [1, 7, 42, 1234, 99999].map((seed) => playRun(seed).blindsCleared)
    for (const count of cleared) {
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThan(24)
    }
  })

  it("has a final target far beyond any single unbuilt guess", () => {
    // Sanity on the curve itself: ante 8 must require a real build, not one
    // lucky word. A bare 5-letter solve tops out in the low thousands.
    expect(blindTargets(ANTES)[2]).toBeGreaterThan(100_000)
  })
})
