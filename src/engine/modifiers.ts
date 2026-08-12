import { MULT_FOR_COLOR } from "../content/letters"
import type { ScoreCtx } from "./scoring"
import type { Rarity, RunState, Tile } from "./state"

/**
 * Letter modifiers — the enhancement layer, Balatro's shape again.
 *
 * There is no deck here to enhance a card in, so the thing that carries a
 * modifier is the letter itself: buy Steel E and every E you ever play is steel,
 * for the rest of the run. That makes a modifier a bet on your own vocabulary
 * rather than on a draw — Gold E pays out most guesses, Gold Z pays out when you
 * force it — which is the decision the shop is really selling.
 *
 * One modifier per letter. Buying a second replaces the first, exactly as an
 * enhancement does, so a letter is a slot rather than a stack. Etchings are the
 * separate, stacking upgrade and survive being modified.
 *
 * Effects get real code and a narrow context, for the same reason jokers do.
 * They fire per scored tile, after the tile's own chips and colour land and
 * before any joker sees it: the letter is what was played, the jokers are what
 * watched.
 *
 * Per tile means per tile for the ×mult ones too: a steel letter multiplies the
 * mult as it stands where it sits, not the finished total, so the same letter is
 * worth more at the end of a word than at the front. That is Balatro's rule and
 * it is worth keeping — it gives word *order* a scoring consequence, which is
 * something this game otherwise has no way to ask about.
 */

export type ModId = "chip" | "mult" | "gold" | "steel" | "glass" | "wild"

export type ModCtx = ScoreCtx & {
  /**
   * A seeded roll for the tile being scored, in [0, 1). Chance effects have to
   * replay identically from a save and from a golden vector, so this is the only
   * randomness a modifier may consult.
   */
  roll(): number
  /**
   * Retire a letter from the alphabet once the guess has finished scoring.
   * Refused if it would leave too little alphabet to spell with.
   */
  burn(letter: string): void
}

export type Modifier = {
  id: ModId
  name: string
  /** Reads after the letter: "K scores ×1.5 mult". */
  text: string
  /** What the key wears in the corner. One or two glyphs — keys are small. */
  pip: string
  rarity: Rarity
  cost: number
  /** Fires once per tile carrying it, before any joker sees that tile. */
  onTile: (ctx: ModCtx, tile: Tile) => void
}

/** How often a glass letter shatters on a tile that shattering is allowed on. */
const GLASS_BREAK = 0.25

export const MODIFIERS: readonly Modifier[] = [
  {
    id: "chip",
    name: "Chip",
    text: "scores +20 chips",
    pip: "+20",
    rarity: "common",
    cost: 4,
    // Flat, and flat is the point: it is worth the same on Q as on E, so it is
    // the one modifier that makes a cheap probing letter worth typing.
    onTile: (ctx) => ctx.addChips(20),
  },
  {
    id: "mult",
    name: "Mult",
    text: "scores +4 mult",
    pip: "+4",
    rarity: "common",
    cost: 5,
    onTile: (ctx) => ctx.addMult(4),
  },
  {
    id: "gold",
    name: "Gold",
    text: "pays $2 every time you play it",
    pip: "$2",
    rarity: "uncommon",
    cost: 6,
    // Income priced against Scavenger, which pays $1 a yellow from a joker slot.
    // This takes no slot and fires on any colour, but only on one letter, so
    // what it is really worth is decided by the letter the shop offered.
    onTile: (ctx) => ctx.addGold(2),
  },
  {
    id: "wild",
    name: "Wild",
    text: "scores as if it were green, whatever it lands",
    pip: "★",
    rarity: "uncommon",
    cost: 6,
    // Colour is this game's suit, so the wild card changes colour rather than
    // suit. It pays most on the guesses that went worst, which makes a throwaway
    // probe cost less — the one thing that reliably softens the game's central
    // tension without touching the tension itself.
    onTile: (ctx, tile) => {
      const gap = MULT_FOR_COLOR.green - MULT_FOR_COLOR[tile.color]
      if (gap > 0) ctx.addMult(gap)
    },
  },
  {
    id: "steel",
    name: "Steel",
    text: "scores ×1.5 mult",
    pip: "×1.5",
    rarity: "rare",
    cost: 8,
    // Multiplicative and per tile, so a doubled steel letter is ×2.25. That is
    // the whole build: steel a letter you can repeat, then find words that do.
    onTile: (ctx) => ctx.timesMult(1.5),
  },
  {
    id: "glass",
    name: "Glass",
    text: "scores ×2 mult, and can shatter when it lands gray",
    pip: "×2",
    rarity: "rare",
    cost: 7,
    onTile: (ctx, tile) => {
      ctx.timesMult(2)
      // Only a gray tile can break it, and only when the letter is genuinely
      // absent from the answer. Gray is not proof of absence — a second E is
      // gray when the answer holds one — and burning a letter the answer needs
      // would leave a blind that cannot be solved by anyone.
      //
      // That the break itself proves absence is the compensation for the risk:
      // a shattered letter is a deduction you did not have to spend a guess on.
      if (tile.color !== "gray") return
      if (ctx.state.blind.answer.includes(tile.letter)) return
      if (ctx.roll() >= GLASS_BREAK) return
      ctx.burn(tile.letter)
    },
  },
]

export const MODIFIER_BY_ID = new Map(MODIFIERS.map((modifier) => [modifier.id, modifier]))

/** The modifier a letter is carrying right now, if any. */
export function modifierOf(state: RunState, letter: string): Modifier | undefined {
  const id = state.letters[letter]?.mod
  return id ? MODIFIER_BY_ID.get(id) : undefined
}
