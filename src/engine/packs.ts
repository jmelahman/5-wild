/**
 * Packs — the shop slot that sells a *choice* rather than a card.
 *
 * Balatro's booster packs, and here they answer a specific problem this game
 * had. The shop picks the letter for you: it rolls Steel, then rolls E, and the
 * pairing is what it is. That makes every letter modifier a bet on a letter you
 * did not choose, which is why the conditional ones had to be priced for the
 * worst letter they might land on — and why Echo needed a pool of letters it was
 * allowed to be sold on at all, rather than the number it wanted.
 *
 * A pack lays several cards out and lets you keep one. That single change is
 * what lets a card be spiky: Anchor on S is the best modifier buy in the game
 * and Anchor on H is nearly nothing, and when you are choosing between them the
 * gap is the decision instead of the tax.
 *
 * Priced off the measured uplift. A modifier dealt by the shop is worth about
 * 3.4 chips a guess averaged over every pairing the roll table can produce;
 * best-of-three is worth 6.1, a 1.77x lift, which puts a three-card pack at
 * about $9 against a $5 card. Going wider runs out of road quickly — best of
 * four is 2.00x and best of five 2.18x — so three is where most of the choice
 * is bought, and the prices below sit a little under fair on purpose. A pack
 * should be the exciting thing on the shelf, not the correct thing.
 */

export type PackId = "alphabet" | "joker" | "category"

export type Pack = {
  id: PackId
  name: string
  text: string
  cost: number
  /** How many cards the pack lays out. */
  options: number
  /** How many of them the player keeps. */
  picks: number
}

/** Every pack lays out three and keeps one; see the note above on why three. */
const OPTIONS = 3

export const PACKS: readonly Pack[] = [
  {
    id: "alphabet",
    name: "Alphabet Pack",
    text: "Choose one of three letter modifiers",
    // The measurement above lands this at $8.9. Rounded down rather than up,
    // because this is the pack that exists to fix the letter-pairing problem
    // and it should be reachable early, when the alphabet is still plain.
    cost: 8,
    options: OPTIONS,
    picks: 1,
  },
  {
    id: "joker",
    name: "Joker Pack",
    text: "Choose one of three jokers",
    // A shade above the alphabet pack though jokers average $6, because jokers
    // are the only line that multiplies and choosing among three is how a run
    // actually gets the one it wants. Held down by the slot cap: the fifth
    // joker is worth much less than the first, so this does not scale away.
    cost: 9,
    options: OPTIONS,
    picks: 1,
  },
  {
    id: "category",
    name: "Category Pack",
    text: "Choose one of three word categories to level",
    // The dearest of the three, and the only one whose choice is strategic
    // rather than tactical. The shop deals a category and you take the level it
    // offers; this hands you the shape to build toward, and a level is the one
    // purchase in the run that compounds for the rest of it.
    cost: 10,
    options: OPTIONS,
    picks: 1,
  },
]

export const PACK_BY_ID: Map<string, Pack> = new Map(PACKS.map((pack) => [pack.id, pack]))
