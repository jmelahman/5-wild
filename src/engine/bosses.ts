import { ANTES } from "../content/blinds"
import { isVowel, LETTER_CHIPS } from "../content/letters"
import { derive, shuffled } from "./rng"
import type { BlindState, RunState, Tile } from "./state"

/**
 * Boss blinds. Each one attacks a specific pole of the deduction/greed tension
 * rather than just raising the target, so the counterplay differs every time:
 * some punish information-gathering, some punish farming.
 *
 * They are banded by ante, and the band is the load-bearing part. This used to
 * be eight bosses across eight antes drawn without replacement, so a run met
 * each exactly once — a nice property, and one that a ninth boss would have
 * silently deleted, turning the sequence into a random subset. Worse, it would
 * have let The Auditor, which caps the solve multiplier at ×2, land on ante 1
 * where no build exists yet to survive it.
 *
 * So the draw is now without replacement *within a band*. A run meets three of
 * the four early bosses, three of the four mid, two of the four late — never
 * the same one twice, never a late boss early, and never the same set twice
 * either, which is what the old scheme gave up in exchange for completeness.
 */
export type BossTier = "early" | "mid" | "late"

/**
 * Which antes each band owns. Late runs to `ANTES` rather than to 8 so that
 * lengthening the run cannot leave an ante without a band to draw from.
 */
const TIER_ANTES: Record<BossTier, { first: number; last: number }> = {
  early: { first: 1, last: 3 },
  mid: { first: 4, last: 6 },
  late: { first: 7, last: ANTES },
}

export type Boss = {
  id: string
  name: string
  text: string
  /** Which third of the run this one is allowed to show up in. */
  tier: BossTier
  /** Overrides the usual six. */
  maxGuesses?: number
  /** Rewrites feedback before it is scored and shown. */
  transform?: (tiles: Tile[]) => void
  /** A rejection reason, or null to allow the guess. */
  validate?: (word: string, blind: BlindState) => string | null
  /** Bends a tile's base chip value. */
  tileChips?: (base: number, tile: Tile, blind: BlindState) => number
  /** Rewrites the solve multiplier, jokers included. Applied last, so a cap caps. */
  solveBonus?: (base: number, blind: BlindState) => number
}

/** Positions the player has already locked in green. */
function knownGreens(blind: BlindState): Map<number, string> {
  const found = new Map<number, string>()
  for (const guess of blind.guesses) {
    guess.tiles.forEach((tile, i) => {
      if (tile.color === "green") found.set(i, tile.letter)
    })
  }
  return found
}

export const BOSSES: readonly Boss[] = [
  {
    id: "silence",
    tier: "mid",
    name: "The Silence",
    text: "No yellow feedback. Misplaced letters read as absent — and score as absent.",
    transform: (tiles) => {
      for (const tile of tiles) {
        if (tile.color === "yellow") {
          tile.color = "gray"
          tile.shown = "gray"
        }
      }
    },
  },
  {
    id: "fog",
    tier: "early",
    name: "The Fog",
    text: "Yellow and gray look identical. They still score differently.",
    // Only `shown` changes: the mult is real, the player just cannot see where
    // it came from. Punishes deduction without touching the math.
    transform: (tiles) => {
      for (const tile of tiles) {
        if (tile.shown === "yellow") tile.shown = "gray"
      }
    },
  },
  {
    id: "tyrant",
    tier: "mid",
    name: "The Tyrant",
    text: "Every guess must reuse the green letters you have found.",
    validate: (word, blind) => {
      for (const [i, letter] of knownGreens(blind)) {
        if (word[i] !== letter) return `must keep ${letter.toUpperCase()} in position ${i + 1}`
      }
      return null
    },
  },
  {
    id: "miser",
    tier: "late",
    name: "The Miser",
    text: "Letters you have already used score no chips.",
    // The sharpest of the set: it forbids the repeat-letter probing that good
    // deduction leans on, so a scoring build has to carry the round.
    tileChips: (base, tile, blind) => {
      const spent = blind.guesses.some((g) => g.word.includes(tile.letter))
      return spent ? 0 : base
    },
  },
  {
    id: "clock",
    tier: "mid",
    name: "The Clock",
    text: "Four guesses only.",
    maxGuesses: 4,
  },
  {
    id: "glutton",
    tier: "early",
    name: "The Glutton",
    text: "Every guess must contain at least two vowels.",
    validate: (word) => {
      const vowels = [...word].filter(isVowel).length
      return vowels >= 2 ? null : "needs at least two vowels"
    },
  },
  {
    id: "auditor",
    tier: "late",
    name: "The Auditor",
    text: "Your solve multiplier is capped at ×2.",
    // Every other blind can be won by banking a modest pile and cashing it in
    // at ×5 or ×6. This one takes the cash-out away and asks whether the build
    // can actually reach the target on its own, which is the question the solve
    // bonus otherwise lets you avoid answering all run.
    solveBonus: (base) => Math.min(2, base),
  },
  {
    id: "purist",
    tier: "early",
    name: "The Purist",
    text: "No letter may appear twice in a guess.",
    // Aimed at the fat scoring words — JAZZY, FUZZY, MUMMY are all chips and no
    // information, and all built on a doubled letter. Deduction barely notices;
    // a chip build loses its best line. The answer pool is filtered by this
    // same rule, so the word is always reachable.
    validate: (word) => (new Set(word).size === word.length ? null : "no repeated letters"),
  },
  {
    id: "drought",
    tier: "early",
    name: "The Drought",
    text: "Vowels score no chips.",
    // The Glutton's opposite number, and deliberately in the same band: one
    // demands vowels, the other refuses to pay for them. A build tuned for
    // either is soft to the other, which is what a band of four is for.
    tileChips: (base, tile) => (isVowel(tile.letter) ? 0 : base),
  },
  {
    id: "mirror",
    tier: "mid",
    name: "The Mirror",
    text: "Your feedback is shown back to front. It still scores as it fell.",
    // The Fog's trick at a longer range: `shown` is reversed and `color` is not,
    // so every point of mult is real and every position you read off the board
    // is a lie. Costs a scoring build nothing and a deducing build everything.
    transform: (tiles) => {
      const shown = tiles.map((tile) => tile.shown)
      tiles.forEach((tile, i) => {
        const flipped = shown[tiles.length - 1 - i]
        if (flipped) tile.shown = flipped
      })
    },
  },
  {
    id: "famine",
    tier: "late",
    name: "The Famine",
    text: "Three guesses only.",
    // The Clock, late and meant it. Three guesses is barely a deduction at all,
    // so this is the blind that asks whether the build can simply out-score the
    // target — and it hands you a ×4 solve multiplier if you can do it at once.
    maxGuesses: 3,
  },
  {
    id: "rust",
    tier: "late",
    name: "The Rust",
    text: "Etchings score nothing. Letters are worth only what they started as.",
    // Aimed squarely at the permanent upgrade line: a run that bought four
    // etchings meets a blind where none of them exist. It reads `LETTER_CHIPS`
    // rather than subtracting the etch, so it stays correct if the etching rules
    // ever change — the claim is "what the letter started as", not "minus what
    // you added".
    tileChips: (_base, tile) => LETTER_CHIPS[tile.letter] ?? 0,
  },
]

const BY_ID = new Map(BOSSES.map((boss) => [boss.id, boss]))

export const getBoss = (id: string | null): Boss | undefined =>
  id === null ? undefined : BY_ID.get(id)

/** The band an ante draws from. Anything past the last band stays in it. */
export function tierForAnte(ante: number): BossTier {
  if (ante <= TIER_ANTES.early.last) return "early"
  if (ante <= TIER_ANTES.mid.last) return "mid"
  return "late"
}

export const bossesIn = (tier: BossTier): readonly Boss[] =>
  BOSSES.filter((boss) => boss.tier === tier)

/**
 * Draw without replacement *within the ante's band*, so a run never meets the
 * same boss twice and never meets a late boss early.
 *
 * Each band gets its own RNG stream, keyed by the band name. Deriving a whole
 * band's order up front — rather than picking one boss per ante — keeps the
 * sequence stable if antes are ever skipped or replayed, and keying by name
 * rather than by index means adding a band cannot reshuffle the others.
 */
export function bossForAnte(state: RunState): string {
  const tier = tierForAnte(state.ante)
  const order = shuffled(derive(state.seed, "bosses", tier), bossesIn(tier))
  // The offset within the band, so ante 4 takes the mid band's first boss
  // rather than its fourth. Modulo covers a band with fewer bosses than antes.
  const boss = order[(state.ante - TIER_ANTES[tier].first) % order.length]
  if (!boss) throw new Error(`no bosses in tier ${tier}`)
  return boss.id
}
