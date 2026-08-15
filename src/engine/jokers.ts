import { CONSUMABLE_SLOTS, INTEREST_PER } from "../content/blinds"
import { ALPHABET, isVowel, MIN_LIVE_LETTERS } from "../content/letters"
import { isCategory } from "./categories"
import type { Rng } from "./rng"
import { shuffled } from "./rng"
import type { ScoreCtx } from "./scoring"
import type { BlindState, GameEvent, JokerInstance, Rarity, RunState, Tile } from "./state"

/**
 * What a run-level hook gets.
 *
 * These fire inside the reducer, which is what owns mutation, so unlike the
 * scoring hooks they write `state` and `instance` straight through rather than
 * handing back a patch. Growth is `ctx.instance.data`, and `slot` is here so a
 * card that grows can emit an event pointing at itself.
 */
export type JokerCtx = {
  state: RunState
  /** This copy's row in `state.jokers`. Write `data` to grow. */
  instance: JokerInstance
  /** This copy's slot, for events that point at the card. */
  slot: number
  rng: Rng
  events: GameEvent[]
}

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
  onBlindStart?: (ctx: JokerCtx) => void
  /**
   * Fires when a blind ends, win or lose, with the finished blind to read —
   * `solved`, the guess list, the final score. The home for growth that is
   * earned over a round rather than over a guess.
   */
  onBlindEnd?: (ctx: JokerCtx, blind: BlindState) => void
  /**
   * Fires on entering the shop, before its stock is rolled — so a joker that
   * bends what the shop offers bends the shop it is about to be shown.
   */
  onShopEnter?: (ctx: JokerCtx) => void
  /**
   * What this copy has grown to, for the card to wear: "+12 mult". Only scaling
   * jokers define it — a joker whose value never moves has nothing to report
   * that its `text` does not already say.
   */
  detail?: (instance: JokerInstance) => string
  /**
   * Added to the blind's solve multiplier. Separate from `onGuess` because the
   * board quotes this figure before the guess exists, so it has to be knowable
   * from the state alone.
   */
  solveBonus?: (state: RunState) => number
  /**
   * Rewrites the interest a cleared blind pays, in slot order. Shaped like
   * `solveBonus` — a run-level number a card is allowed to bend — rather than a
   * flag, because the interesting version of this is a card that *takes the
   * interest away* in exchange for something, and a boolean could only ever say
   * one thing.
   */
  interest?: (base: number, state: RunState) => number
}

/** What a growing joker has banked, and the key every one of them stores it under. */
const grown = (instance: JokerInstance, key: string): number => instance.data?.[key] ?? 0

/**
 * Bank a step of growth and announce it. Shared because all three growing
 * jokers do exactly this and the announcement is the part worth keeping
 * identical: the player learns "this card just got bigger" from one animation,
 * whatever earned it.
 */
function grow(ctx: JokerCtx, id: string, key: string, step: number, unit: string): void {
  const total = grown(ctx.instance, key) + step
  ctx.instance.data = { ...ctx.instance.data, [key]: total }
  ctx.events.push({ type: "joker_grew", slot: ctx.slot, id, label: `+${total} ${unit}` })
}

const RARITY_COST: Record<Rarity, number> = {
  common: 4,
  uncommon: 6,
  rare: 8,
  legendary: 10,
}

/**
 * Twenty-three jokers, spread deliberately across archetypes so a build identity
 * shows up within the first shop. Note that scoring always reads `tile.color`,
 * never `tile.shown` — The Fog lies to the player, not to the math.
 *
 * The axis most of these sit on is the one the solve bonus creates: farming a
 * blind grows the pile the bonus will multiply, and costs a point of that
 * multiplier per guess. Slow Burn and The Vault pay for staying; Sunk Cost and
 * Speedrunner pay for leaving. Owning a pair from opposite ends is a real
 * dilemma rather than a stack, which is the point.
 *
 * The last five arrived together, and each answers something the build rubric
 * found missing: a terminal for the money build, a payoff that makes burning
 * the alphabet a plan rather than a tax, and three cards that *grow* — one on a
 * guess condition, one on a blind condition, one on a shop condition — so that
 * scaling reads as a class of card and not as one oddity.
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
      if (isCategory("cluster", ctx.word)) ctx.timesMult(1.5)
    },
  },
  {
    id: "cold_open",
    name: "Cold Open",
    text: "+30 chips on the first guess of a blind",
    rarity: "common",
    cost: RARITY_COST.common,
    // The opening probe is the guess with the least information behind it and
    // the most riding on it, and until now it was the one nothing paid for.
    onGuess: (ctx) => {
      if (ctx.guessIndex === 0) ctx.addChips(30)
    },
  },
  {
    id: "bloodhound",
    name: "Bloodhound",
    text: "+6 chips per yellow tile",
    rarity: "common",
    cost: RARITY_COST.common,
    // Yellow is the colour that actually teaches you something, so this is the
    // rare joker that pays for playing well rather than for playing wide.
    onTile: (ctx, tile) => {
      if (tile.color === "yellow") ctx.addChips(6)
    },
  },
  {
    id: "anagrammer",
    name: "Anagrammer",
    text: "×2 mult if no letter repeats",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    // Five distinct letters is exactly what a good probe looks like, and the
    // exact opposite of what Doppelgänger wants. They do not belong in the
    // same build, which is what makes each of them a choice.
    onGuess: (ctx) => {
      if (isCategory("distinct", ctx.word)) ctx.timesMult(2)
    },
  },
  {
    id: "sunk_cost",
    name: "Sunk Cost",
    text: "+10 mult per guess you would have left",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    // Slow Burn read backwards: this one is worth most on the guess where the
    // solve bonus is also worth most, so it sharpens the incentive to leave
    // early instead of blunting it.
    onGuess: (ctx) => {
      if (ctx.guessesLeft > 0) ctx.addMult(10 * ctx.guessesLeft)
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
    id: "hot_streak",
    name: "Hot Streak",
    text: "Permanently gains +30 chips each blind you clear in 3 guesses or fewer",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    // The growth counterpart to Speedrunner, on the chip axis: both pull toward
    // cashing out early, and both are dead weight in a Slow Burn build. A
    // farming run will never trip this, which is the whole point of it.
    onGuess: (ctx) => {
      const banked = ctx.getData("chips")
      if (banked > 0) ctx.addChips(banked)
    },
    onBlindEnd: (ctx, blind) => {
      if (blind.solved && blind.guesses.length <= 3) grow(ctx, "hot_streak", "chips", 30, "chips")
    },
    detail: (instance) => `+${grown(instance, "chips")} chips`,
  },
  {
    id: "hoarder",
    name: "The Hoarder",
    text: "Permanently gains +40 chips when you reach the shop with both card slots full",
    rarity: "uncommon",
    cost: RARITY_COST.uncommon,
    // Consumables exist to be spent, and this pays you not to spend them. That
    // is the tension it is for: every Oracle you sit on is information you chose
    // not to have, banked as chips instead.
    onGuess: (ctx) => {
      const banked = ctx.getData("chips")
      if (banked > 0) ctx.addChips(banked)
    },
    onShopEnter: (ctx) => {
      if (ctx.state.consumables.length >= CONSUMABLE_SLOTS) {
        grow(ctx, "hoarder", "chips", 40, "chips")
      }
    },
    detail: (instance) => `+${grown(instance, "chips")} chips`,
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
      if (isCategory("alphabetical", ctx.word)) ctx.timesMult(2)
    },
  },
  {
    id: "vault",
    name: "The Vault",
    text: "+25 chips for each guess already made this blind",
    rarity: "rare",
    cost: RARITY_COST.rare,
    // Slow Burn's chip half, so a farming build can grow both halves of the
    // product instead of one. Together they are the strongest argument in the
    // game for spending the whole guess budget — and the solve multiplier is
    // the strongest argument against.
    onGuess: (ctx) => {
      if (ctx.guessIndex > 0) ctx.addChips(25 * ctx.guessIndex)
    },
  },
  {
    id: "mint",
    name: "The Mint",
    text: "+3 mult per $5 you hold. You earn no interest.",
    rarity: "rare",
    cost: RARITY_COST.rare,
    // The money build's terminal — the thing that finally converts a pile of
    // gold into score instead of into more gold.
    //
    // Priced by taking the interest away rather than by picking a small number.
    // Interest already pays you to hoard; a card that *also* paid you to hoard
    // would not be a choice, it would be the answer. This way the two are
    // alternatives: compound the pile, or cash it in every guess.
    onGuess: (ctx) => {
      const steps = Math.floor(ctx.state.gold / INTEREST_PER)
      if (steps > 0) ctx.addMult(3 * steps)
    },
    interest: () => 0,
  },
  {
    id: "scorched_earth",
    name: "Scorched Earth",
    text: "+12 mult for each letter burnt out of the alphabet",
    rarity: "rare",
    cost: RARITY_COST.rare,
    // What makes Pyromaniac and Glass a plan rather than a tax. The alphabet
    // stops at MIN_LIVE_LETTERS, so eleven letters is the ceiling and +132 mult
    // is what a fully committed sacrifice run is buying — paid for with a
    // keyboard that can no longer type eleven letters, which is a real price.
    onGuess: (ctx) => {
      const burnt = [...ALPHABET].filter((letter) => ctx.state.letters[letter]?.destroyed).length
      if (burnt > 0) ctx.addMult(12 * burnt)
    },
  },
  {
    id: "snowball",
    name: "Snowball",
    text: "Permanently gains +1 mult for each green tile you play",
    rarity: "rare",
    cost: RARITY_COST.rare,
    // Pays what it had, *then* counts this guess — so a tile never pays on the
    // guess that earned it. Growing after paying is what keeps the card legible:
    // the number on the card is the number it just added.
    //
    // One, from five, by way of two. The value was never the whole problem: the
    // ceiling at +2 landed near +200, which is where a growing card *should*
    // finish, and it still read as an auto-buy. The reason is that it asks for
    // nothing. Its two siblings both name a condition — Hot Streak wants the
    // blind cleared in three, The Hoarder wants both slots full at the shop —
    // and every word ever typed has green tiles in it. An unconditional card at
    // $6 that ends the run as the biggest number on the board is not a build,
    // it is a tax on not buying it.
    //
    // So the rarity is the real fix and the halving is the trim that follows
    // it. Across 300 recorded runs of the greedy bot the card went from a mean
    // +154 at the ending (median 170, peak 230) to a mean +61 (median 60, peak
    // 115) — still the strongest rare on the mult axis, no longer three times
    // the field. The number that matters most is the one that did *not* move:
    // the win rate held at 10.0% against 10.3% and the mean final ante at 4.90
    // against 4.89. Sixty points came off the best card in the game and the
    // game did not get harder, which is what it looks like when a card was
    // crowding builds out rather than carrying them.
    //
    // Being rare also self-corrects on the axis that matters, since the shelf
    // tilts *toward* rare as the antes go by and a Snowball found at ante 7 has
    // almost nothing left to eat.
    onGuess: (ctx) => {
      const banked = ctx.getData("mult")
      if (banked > 0) ctx.addMult(banked)
      const greens = ctx.tiles.filter((tile) => tile.color === "green").length
      if (greens > 0) ctx.setData("mult", banked + greens)
    },
    detail: (instance) => `+${grown(instance, "mult")} mult`,
  },
  {
    id: "long_game",
    name: "The Long Game",
    text: "+1 to your solve multiplier",
    rarity: "legendary",
    cost: RARITY_COST.legendary,
    // Buys back a guess's worth of multiplier, so every point of farming is
    // worth more and the cash-out can wait one turn longer. It multiplies the
    // whole pile, which is why a flat +1 belongs at this rarity.
    solveBonus: () => 1,
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
    onBlindStart: ({ state, rng, events }) => {
      const alive = [...ALPHABET].filter((letter) => !state.letters[letter]?.destroyed)
      // Leave enough alphabet to still form words; refuse to burn past that.
      // The same floor a shattering letter stops at — one rule, two ways in.
      if (alive.length < MIN_LIVE_LETTERS) return
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
