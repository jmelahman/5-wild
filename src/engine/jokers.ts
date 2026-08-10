import { ALPHABET, isVowel } from "../content/letters"
import type { Rng } from "./rng"
import { shuffled } from "./rng"
import type { ScoreCtx } from "./scoring"
import type { GameEvent, Rarity, RunState, Tile } from "./state"

export type Joker = {
  id: string
  name: string
  text: string
  rarity: Rarity
  cost: number
  /** Fires once per tile, left to right, after that tile's base chips land. */
  onTile?: (ctx: ScoreCtx, tile: Tile, index: number, base: number) => void
  /** Fires once after all tiles, in slot order. */
  onGuess?: (ctx: ScoreCtx) => void
  /** Fires when a blind begins — before the answer is chosen. */
  onBlindStart?: (state: RunState, rng: Rng, events: GameEvent[]) => void
}

const RARITY_COST: Record<Rarity, number> = {
  common: 4,
  uncommon: 6,
  rare: 8,
  legendary: 10,
}

/**
 * Twelve jokers, spread deliberately across archetypes so a build identity
 * shows up within the first shop. Note that scoring always reads `tile.color`,
 * never `tile.shown` — The Fog lies to the player, not to the math.
 */
export const JOKERS: readonly Joker[] = [
  {
    id: "green_thumb",
    name: "Green Thumb",
    text: "+8 chips per green tile",
    rarity: "common",
    cost: RARITY_COST.common,
    onTile: (ctx, tile) => {
      if (tile.color === "green") ctx.addChips(8)
    },
  },
  {
    id: "scavenger",
    name: "Scavenger",
    text: "+$1 per yellow tile",
    rarity: "common",
    cost: RARITY_COST.common,
    onTile: (ctx, tile) => {
      if (tile.color === "yellow") ctx.addGold(1)
    },
  },
  {
    id: "vowel_hoarder",
    name: "Vowel Hoarder",
    text: "+4 mult per vowel",
    rarity: "common",
    cost: RARITY_COST.common,
    onTile: (ctx, tile) => {
      if (isVowel(tile.letter)) ctx.addMult(4)
    },
  },
  {
    id: "slow_burn",
    name: "Slow Burn",
    text: "+5 mult for each guess already made this blind",
    rarity: "common",
    cost: RARITY_COST.common,
    // Pays you to stall, which is the exact opposite of what the solve bonus
    // pays you to do. Owning both is a genuine dilemma rather than a stack.
    onGuess: (ctx) => {
      if (ctx.guessIndex > 0) ctx.addMult(5 * ctx.guessIndex)
    },
  },
  {
    id: "consonant_cluster",
    name: "Consonant Cluster",
    text: "×1.5 mult if the word has 3+ consonants in a row",
    rarity: "common",
    cost: RARITY_COST.common,
    onGuess: (ctx) => {
      let run = 0
      for (const letter of ctx.word) {
        run = isVowel(letter) ? 0 : run + 1
        if (run >= 3) {
          ctx.timesMult(1.5)
          return
        }
      }
    },
  },
  {
    id: "speedrunner",
    name: "Speedrunner",
    text: "×3 mult when you solve in 3 guesses or fewer",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    onGuess: (ctx) => {
      if (ctx.solved && ctx.guessIndex <= 2) ctx.timesMult(3)
    },
  },
  {
    id: "qs_bargain",
    name: "Q's Bargain",
    text: "J, Q, X and Z score triple chips",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    onTile: (ctx, tile, _index, base) => {
      if ("jqxz".includes(tile.letter)) ctx.addChips(base * 2)
    },
  },
  {
    id: "greedy_grammarian",
    name: "Greedy Grammarian",
    text: "+15 chips per gray tile",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    // Gray tiles are worthless for deduction and contribute no mult, which
    // makes them the perfect substrate for rewarding being spectacularly wrong.
    onTile: (ctx, tile) => {
      if (tile.color === "gray") ctx.addChips(15)
    },
  },
  {
    id: "doppelganger",
    name: "Doppelgänger",
    text: "Repeated letters score their chips twice",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    onTile: (ctx, tile, _index, base) => {
      const copies = [...ctx.word].filter((letter) => letter === tile.letter).length
      if (copies > 1) ctx.addChips(base)
    },
  },
  {
    id: "masochist",
    name: "Masochist",
    text: "+8 mult per gray tile",
    rarity: "rare",
    cost: RARITY_COST.rare,
    onTile: (ctx, tile) => {
      if (tile.color === "gray") ctx.addMult(8)
    },
  },
  {
    id: "alphabetist",
    name: "Alphabetist",
    text: "×2 mult if your letters are in alphabetical order",
    rarity: "rare",
    cost: RARITY_COST.rare,
    onGuess: (ctx) => {
      // "" sorts below every letter, so the missing predecessor at index 0 is
      // trivially satisfied — the same thing the index guard would have said.
      const ordered = [...ctx.word].every((letter, i, all) => letter >= (all[i - 1] ?? ""))
      if (ordered) ctx.timesMult(2)
    },
  },
  {
    id: "pyromaniac",
    name: "Pyromaniac",
    text: "+40 mult. Burns a random letter out of the alphabet each blind",
    rarity: "legendary",
    cost: RARITY_COST.legendary,
    onGuess: (ctx) => ctx.addMult(40),
    // Runs before the answer is drawn, so a burnt letter genuinely cannot
    // appear in the word — the search space shrinks along with your keyboard.
    onBlindStart: (state, rng, events) => {
      const alive = [...ALPHABET].filter((letter) => !state.letters[letter]?.destroyed)
      // Leave enough alphabet to still form words; refuse to burn past that.
      if (alive.length <= 14) return
      const letter = shuffled(rng, alive)[0]
      if (letter === undefined) return
      const entry = state.letters[letter]
      if (!entry) return
      entry.destroyed = true
      events.push({ type: "letter_destroyed", letter })
    },
  },
]

export const JOKER_BY_ID = new Map(JOKERS.map((joker) => [joker.id, joker]))
