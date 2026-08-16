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
 * Effects get real code and a narrow context, for the same reason relics do.
 * They fire per scored tile, after the tile's own chips and colour land and
 * before any relic sees it: the letter is what was played, the relics are what
 * watched.
 *
 * Per tile means per tile for the ×mult ones too: a steel letter multiplies the
 * mult as it stands where it sits, not the finished total, so the same letter is
 * worth more at the end of a word than at the front. That is Balatro's rule and
 * it is worth keeping — it gives word *order* a scoring consequence, which is
 * something this game otherwise has no way to ask about.
 */

export type ModId =
  | "chip"
  | "mult"
  | "gold"
  | "steel"
  | "glass"
  | "wild"
  | "lucky"
  | "echo"
  | "anchor"

export type ModCtx = ScoreCtx & {
  /**
   * Retire a letter from the alphabet once the guess has finished scoring.
   * Refused if it would leave too little alphabet to spell with.
   *
   * The only thing a modifier gets that a relic does not — `roll` lives on
   * `ScoreCtx` now, since both need seeded chance and neither may reach for
   * anything else.
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
  /**
   * What it costs on a letter somebody else picked — the price a pack quotes,
   * and the one the shop used to charge back when it rolled the pairing too.
   */
  cost: number
  /**
   * What the shop charges to sell it unattached, for the player to point at a
   * letter of their own choosing.
   *
   * Dearer than `cost`, and it has to be: a rolled Chip is worth 0.96 chips a
   * gold averaged over the alphabet, and Chip on E is worth 2.65. Choice is most
   * of this card's value, so the shop that hands it over has to charge for it.
   * Not the full 2.8× though — a rolled pairing you did not like was never
   * bought, so what the premium is really buying is the visits where the letter
   * slot used to be dead, and those were already worth nothing.
   *
   * Set per card rather than derived, because the spread is not uniform: Echo
   * only ever goes on six letters, so choosing among them is worth less than
   * choosing among 26, and Anchor's whole value is which letter it lands on.
   */
  choiceCost: number
  /**
   * The letters this may be sold on, when it cannot go on just any of them.
   * Absent means the whole alphabet, which is the ordinary case.
   *
   * This exists because a conditional modifier can be sold onto a letter that
   * can never satisfy the condition, and then it is not a weak card but a dead
   * one. Echo pays on a repeated letter, and no five-letter answer repeats a J,
   * Q or X at all — the shop was charging $5 for a card guaranteed to do
   * nothing. A restriction is the honest fix, because the alternative is
   * pricing every conditional card for the worst letter it might land on, which
   * makes it worthless on the good ones too.
   *
   * Only for conditions that are *independent* of how often the letter comes
   * up. Anchor needs a green tile, and a rare letter is green rarely for the
   * same reason it scores rarely — that is the ordinary Gold Z bet the whole
   * layer is built on, and it does not need protecting from.
   */
  letters?: string
  /** Fires once per tile carrying it, before any relic sees that tile. */
  onTile: (ctx: ModCtx, tile: Tile) => void
}

/** How often a glass letter shatters on a tile that shattering is allowed on. */
const GLASS_BREAK = 0.25

/** How often a lucky letter pays. */
const LUCKY_CHANCE = 0.25

export const MODIFIERS: readonly Modifier[] = [
  {
    id: "chip",
    name: "Chip",
    text: "scores +20 chips",
    pip: "+20",
    rarity: "common",
    cost: 4,
    choiceCost: 6,
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
    choiceCost: 8,
    onTile: (ctx) => ctx.addMult(4),
  },
  {
    id: "gold",
    name: "Gold",
    text: "pays $2 every time you play it",
    pip: "$2",
    rarity: "uncommon",
    cost: 6,
    choiceCost: 9,
    // Income priced against Scavenger, which pays $1 a yellow from a relic slot.
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
    choiceCost: 9,
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
    id: "lucky",
    name: "Lucky",
    text: "has a 1 in 4 chance of scoring +20 mult",
    pip: "?",
    rarity: "uncommon",
    cost: 6,
    choiceCost: 9,
    // Expects +5 mult a tile against Mult's flat +4 for a gold less, so the
    // premium is entirely for the variance — which is the trade Balatro's Lucky
    // card offers too. It is the only modifier whose value you cannot read off
    // the board before you submit, and the one guess in four that it lands on is
    // worth waiting for.
    onTile: (ctx) => {
      if (ctx.roll() < LUCKY_CHANCE) ctx.addMult(20)
    },
  },
  {
    id: "echo",
    name: "Echo",
    text: "scores +60 chips when the word repeats it",
    pip: "↺",
    rarity: "uncommon",
    cost: 5,
    choiceCost: 7,
    // Fires on every copy, so a doubled letter collects +120 across the word.
    // Pays a player for the shape the Twinned category and Anagrammer already
    // reward, which is the point: a modifier that only pays inside a build can
    // afford a bigger number than a flat one.
    //
    // Sold only on the six letters an answer actually doubles in more than 2%
    // of words. Below that the card is decoration: an answer repeats a W in one
    // word out of two thousand and a J, Q or X in none at all. Restricted to
    // AELOST, +60 is worth 0.97 chips a gold against Chip's flat 0.96 — the
    // same money, taken in a lump on the words that earn it.
    letters: "aelost",
    onTile: (ctx, tile) => {
      const copies = [...ctx.word].filter((letter) => letter === tile.letter).length
      if (copies >= 2) ctx.addChips(60)
    },
  },
  {
    id: "anchor",
    name: "Anchor",
    text: "scores +250 chips when it lands green",
    pip: "⚓",
    rarity: "uncommon",
    cost: 5,
    choiceCost: 9,
    // Wild's opposite number, deliberately: Wild pays most on the guess that
    // went worst, this pays only on the letter you have already nailed. Both
    // sides of the colour line are now purchasable.
    //
    // Back-loaded by nature, since greens accumulate through a round, and it
    // rewards re-typing a letter you have locked — which The Tyrant compels and
    // The Miser forbids, so the same card swings hard either way.
    //
    // Priced the same way as Echo, off the same measurement: only 8.8% of tiles
    // land green, which left +50 worth 0.17 chips a gold. +250 brings the
    // average to 0.84 and makes Anchor on S the single best modifier buy in the
    // game — which is the whole idea, since the letter it sits on is printed on
    // the card and reading it is the decision the slot is there to ask for.
    onTile: (ctx, tile) => {
      if (tile.color === "green") ctx.addChips(250)
    },
  },
  {
    id: "steel",
    name: "Steel",
    text: "scores ×1.5 mult",
    pip: "×1.5",
    rarity: "rare",
    cost: 8,
    choiceCost: 12,
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
    choiceCost: 11,
    onTile: (ctx, tile) => {
      ctx.timesMult(2)
      // Only a gray tile can break it, and only when the letter is genuinely
      // absent from the answer. Gray is not proof of absence — a second E is
      // gray when the answer holds one — and burning a letter the answer needs
      // would leave a round that cannot be solved by anyone.
      //
      // That the break itself proves absence is the compensation for the risk:
      // a shattered letter is a deduction you did not have to spend a guess on.
      if (tile.color !== "gray") return
      if (ctx.state.round.answer.includes(tile.letter)) return
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
