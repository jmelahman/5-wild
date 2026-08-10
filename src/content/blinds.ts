/** Run pacing and the score curve. Balatro's shape, our numbers. */

export const ANTES = 8
export const BLINDS_PER_ANTE = 3
export const BASE_GUESSES = 6

export const JOKER_SLOTS = 5
export const CONSUMABLE_SLOTS = 2

export const BLIND_NAMES = ["Small Blind", "Big Blind", "Boss Blind"] as const
export const BLIND_PAYOUT = [3, 4, 5] as const

/** Gold per unused guess, and the interest cap. */
export const GOLD_PER_UNUSED_GUESS = 1
export const INTEREST_PER = 5
export const INTEREST_CAP = 5

export const STARTING_GOLD = 4

/**
 * Hand-authored through ante 3 — the part a player actually meets while
 * learning — then geometric. The multiplier is the single knob that decides
 * whether the late game is about scaling or about dying, so it lives alone.
 */
const AUTHORED: ReadonlyArray<readonly [number, number, number]> = [
  [300, 450, 600],
  [800, 1200, 1600],
  [2000, 3000, 4000],
]
const ANTE_GROWTH = 2.2

export function blindTargets(ante: number): readonly [number, number, number] {
  const authored = AUTHORED[ante - 1]
  if (authored) return authored

  const last = AUTHORED[AUTHORED.length - 1]
  if (!last) throw new Error("no authored antes")

  // Round each step to the nearest 100 so targets stay readable at a glance;
  // compounding the rounding is fine, it only ever flattens the curve slightly.
  let [small, big, boss] = last
  for (let a = AUTHORED.length; a < ante; a++) {
    const grow = (v: number) => Math.round((v * ANTE_GROWTH) / 100) * 100
    ;[small, big, boss] = [grow(small), grow(big), grow(boss)]
  }
  return [small, big, boss]
}
