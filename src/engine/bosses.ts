import { isVowel } from "../content/letters"
import { derive, shuffled } from "./rng"
import type { BlindState, RunState, Tile } from "./state"

/**
 * Boss blinds. Each one attacks a specific pole of the deduction/greed tension
 * rather than just raising the target, so the counterplay differs every time:
 * some punish information-gathering, some punish farming.
 *
 * There are eight of them and eight antes, drawn without replacement, so a full
 * run meets each exactly once and never twice.
 */
export type Boss = {
  id: string
  name: string
  text: string
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
    name: "The Clock",
    text: "Four guesses only.",
    maxGuesses: 4,
  },
  {
    id: "glutton",
    name: "The Glutton",
    text: "Every guess must contain at least two vowels.",
    validate: (word) => {
      const vowels = [...word].filter(isVowel).length
      return vowels >= 2 ? null : "needs at least two vowels"
    },
  },
  {
    id: "auditor",
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
    name: "The Purist",
    text: "No letter may appear twice in a guess.",
    // Aimed at the fat scoring words — JAZZY, FUZZY, MUMMY are all chips and no
    // information, and all built on a doubled letter. Deduction barely notices;
    // a chip build loses its best line. The answer pool is filtered by this
    // same rule, so the word is always reachable.
    validate: (word) => (new Set(word).size === word.length ? null : "no repeated letters"),
  },
]

const BY_ID = new Map(BOSSES.map((boss) => [boss.id, boss]))

export const getBoss = (id: string | null): Boss | undefined =>
  id === null ? undefined : BY_ID.get(id)

/**
 * Draw without replacement so a run does not serve the same boss twice before
 * showing all of them. Deriving the whole order from the seed up front — rather
 * than picking one per ante — keeps the sequence stable if antes are ever
 * skipped or replayed.
 */
export function bossForAnte(state: RunState): string {
  const order = shuffled(derive(state.seed, "bosses"), BOSSES)
  const boss = order[(state.ante - 1) % order.length]
  if (!boss) throw new Error("no bosses defined")
  return boss.id
}
