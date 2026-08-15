import { BASE_GUESSES, JOKER_SLOTS } from "../content/blinds"
import { getBoss } from "./bosses"
import { found, keepGreens, useFound } from "./rules"
import type { RunState } from "./state"

/**
 * Ascensions: the run's standing difficulty, chosen before it starts.
 *
 * Linear, in Slay the Spire's model — ascension N plays every rule up to and
 * including N — rather than a weighted or random selection. Weighted sounds like
 * more content and is less: a player cannot learn a difficulty they cannot
 * predict, a build cannot be planned against a rule that might not appear, and
 * every combination becomes a balance surface nobody tested. Linear gives an
 * ordered curve, one new thing to learn per step, and ten configurations to
 * verify instead of a thousand and twenty-three.
 *
 * The ladder is in two halves. Rungs 1–10 are written by hand and each adds a
 * *rule* — five of them guess rules sharing their machinery with the bosses,
 * five of them bends in the run's own arithmetic. Above 10 there are no rules
 * left worth inventing, so the ladder stops pretending: every rung after the
 * tenth is the targets rising another notch, forever. That is deliberate. A
 * ladder with a top has a last thing to beat and then nothing; a ladder without
 * one is its own scoreboard, and "how high did you get" is a better long-run
 * question than "what was your final score", which depends mostly on how long a
 * won run was farmed.
 *
 * They stack in roughly the order they hurt: the guess rules first, because
 * they cost a play and not a run, then the economy, then the curve, then the
 * tray, then the sixth guess. The tenth is the sharpest thing in the game.
 *
 * Measured over 250 seeds a piece, with a bot that farms the best word it can
 * find and solves the moment solving would clear the target:
 *
 *   A0  win 29.6%   A6  21.2%   A8  12.4%   A10  9.6%
 *   A5      24.8%   A7  17.2%   A9   9.6%
 *
 * — which is the shape the ladder wanted: three to five points a rung, so every
 * step is felt and none is a wall. The one flat stretch is 9 to 10, and it is an
 * artefact of the instrument rather than of the ladder: this bot always solves,
 * so Finish It takes nothing from it and everything from the player who was
 * hedging. Rung 8 is understated for a related reason. See both in place.
 */
export type Ascension = {
  /** The level this arrives at. A run at level N plays every rule at or below N. */
  level: number
  name: string
  /** The rule in words, for the screen that has to sell it before it is chosen. */
  text: string
  /** A rejection reason, or null to allow the guess. */
  validate?: (word: string, state: RunState) => string | null
  /** Ascension 10 alone: clearing the target stops being enough. */
  solveRequired?: true
  /** Gold this rule takes off every blind's base payout. */
  payoutCut?: number
  /** What this rule multiplies every blind's target by. */
  targets?: number
  /** Joker slots this rule takes off the tray. */
  jokerCut?: number
  /** Guesses this rule takes off the blind's allowance. */
  guessCut?: number
}

export const ASCENSIONS: readonly Ascension[] = [
  {
    level: 1,
    name: "Hunted",
    text: "Every guess must use the letters you have found.",
    // Wordle's hard mode, and the mildest thing here: it costs the player their
    // throwaway probing words, and nothing else.
    validate: (word, state) => useFound(word, found(state.blind, "yellow")),
  },
  {
    level: 2,
    name: "Once Only",
    text: "No word twice in the same blind.",
    // Barely a constraint on its own — nobody guesses the same word twice on
    // purpose — but it is the floor the next one is built on.
    validate: (word, state) =>
      state.blind.guesses.some((guess) => guess.word === word)
        ? "already guessed this blind"
        : null,
  },
  {
    level: 3,
    name: "No Echoes",
    text: "No word twice in the whole run.",
    // The first rule that costs a build rather than a guess: the opener that
    // scores best is gone after ante one, and a run has to keep finding new
    // words that pay. This is why the run keeps a history at all.
    validate: (word, state) => (state.history?.includes(word) ? "already used this run" : null),
  },
  {
    level: 4,
    name: "Anchored",
    text: "Every guess must use the letters you have placed.",
    // Greens, unpositioned — the step between hard mode and The Tyrant. Once
    // level 5 lands this can no longer fire on its own, since a letter kept in
    // its place is by definition still in the word.
    validate: (word, state) => useFound(word, found(state.blind, "green")),
  },
  {
    level: 5,
    name: "Tyranny",
    text: "Letters you have placed must stay where you placed them.",
    // The Tyrant, permanently. Shares its implementation with the boss rather
    // than restating it, so the run-long version cannot drift from the one the
    // player met on ante 4.
    validate: (word, state) => keepGreens(word, state.blind),
  },
  {
    level: 6,
    name: "Lean Years",
    text: "Every blind pays $1 less.",
    /*
     * Where the ladder stops asking about words and starts asking about money.
     *
     * A flat dollar off the base — $3/$4/$5 becomes $2/$3/$4 — rather than the
     * obvious alternative, which was to stop paying for unused guesses. That
     * alternative would have been actively wrong. The unused-guess dollar is the
     * only reward in the game on a different axis from the score curve, and the
     * only measured lever that pulls a player toward solving early rather than
     * farming five wrong words to the target; deleting it at rung 6 would have
     * tilted the entire upper ladder toward farming.
     *
     * Cutting the base does the opposite. At $2 instead of $3 the unused-guess
     * dollars are a larger share of the take, so the higher a run climbs the more
     * it is paid to finish early — which is the behaviour the rest of the ladder
     * is about to start demanding outright at rung 10.
     *
     * A dollar sounds small and is a quarter of the base: $12 a lap becomes $9.
     * Measured against everything a run actually earns — unused-guess dollars and
     * interest included, which is why the headline number overstates it — income
     * falls 12%, from $9.29 a blind to $8.20, and the win rate from 24.8% to
     * 21.2% over 250 seeds. Interest is capped at $5 and so cushions almost none
     * of it; what the run loses is close to one shop visit in eight.
     */
    payoutCut: 1,
  },
  {
    level: 7,
    name: "Steeper",
    text: "Every target is 15% higher.",
    /*
     * The curve itself, and the shape every rung above 10 repeats at a gentler
     * angle — see `ENDLESS_STEP`.
     *
     * 15% is picked against the ante growth rather than in the abstract. Targets
     * multiply by 2.2 an ante, so a notch this size is worth about a fifth of an
     * ante of standing pressure: enough to feel on the blind it lands on, not
     * enough to end a run by itself. It measures at 21.2% to 17.2%, final ante
     * 6.56 to 6.34, over 250 seeds — and it is the only authored rung that takes
     * nothing away, which is why it can sit this high while costing this little.
     * Every other rung removes a resource; this one just moves the finish line.
     */
    targets: 1.15,
  },
  {
    level: 8,
    name: "Crowded",
    text: "Four joker slots, not five.",
    /*
     * The build, capped.
     *
     * This was written first as a cut to the *shelf* — the shop dealing one joker
     * instead of two — and 250 seeds said that rule does nothing at all: win rate
     * 17.2% either way, tray value $32.1 to $31.1, and the same 4.97 cards held at
     * the end. Which makes sense in hindsight. A run visits the shop around
     * nineteen times, so even one look a visit is nineteen looks for five slots;
     * what stops a tray filling is gold, not offers, and halving the offers
     * changes neither. It read as a difficulty rule and was scenery.
     *
     * Taking the slot instead bites: 17.2% to 12.4%, tray value $32.1 to $26.0,
     * 4.97 cards held to 3.98. The difference is that this one cannot be waited
     * out. Every joker bought past the fourth now has to displace one already
     * earning, so the rung asks a question the shelf-cut never did — not "did you
     * find it" but "is it better than what you have" — and it asks it in every
     * shop for the rest of the run.
     *
     * The −19% of tray value is the honest measure of the cost, and it is worth
     * noting that a bot understates it: this player has no preference among
     * jokers, so it loses an average slot where a human loses their fifth-best.
     */
    jokerCut: 1,
  },
  {
    level: 9,
    name: "Five",
    text: "Five guesses, not six.",
    /*
     * The board itself, at last, and the second-sharpest thing here.
     *
     * It hits three ways at once, which is why it sits this high. The deduction
     * gets a guess harder. The chip pile a farming line can build loses its
     * biggest contributor. And the income drops again — the unused-guess dollars
     * are capped one lower, on top of Lean Years already having taken a dollar
     * off the base — so the run that responds by farming is the run that cannot
     * afford the shop.
     *
     * All three show up at once in the measurement: 12.4% to 9.6%, and income
     * from $8.16 a blind to $7.09 — the only rung besides Lean Years that moves
     * the money, and it does so without mentioning money.
     *
     * A boss that limits guesses of its own still wins where it is tighter: The
     * Clock's four and The Famine's three are the tightest the board ever gets,
     * and this must not quietly loosen them. See `beginBlind`.
     */
    guessCut: 1,
  },
  {
    level: 10,
    name: "Finish It",
    text: "Reaching the target is not enough. You have to solve the word.",
    /*
     * The sharpest rule in the game, and the reason it is the last authored one.
     * Every other blind can be won by farming chips off five wrong guesses and
     * never finding the answer; this deletes that line, and with it the whole
     * deduction-versus-greed hedge. The word is the point again. Everything above
     * it is pressure rather than rule, so this is the last thing the ladder ever
     * has to teach — the right note to end the taught half on, and the wrong one
     * to have buried in the middle of it.
     *
     * It is also the one rung the harness scores at exactly zero: 9.6% at A9 and
     * 9.6% at A10, identical on final ante, blinds cleared and gold per blind,
     * because a bot that solves every blind it can already obeys this rule and
     * never noticed it arrive. That is not evidence the rung is free — it is
     * evidence of what the rung taxes. What it costs is the hedge, and the hedge
     * is a human move: the blind where the word will not come, the pile is nearly
     * there, and two more wrong guesses would bank it anyway. Under this rule that
     * blind is lost. No bot that always finds the answer can price that, and no
     * player will need it priced.
     */
    solveRequired: true,
  },
]

/** Where the hand-written half stops and the ladder starts repeating itself. */
export const AUTHORED_ASCENSIONS = ASCENSIONS.length

/**
 * What each rung above `AUTHORED_ASCENSIONS` multiplies the targets by, on top
 * of everything below it. Steeper's rule at roughly half Steeper's angle, and
 * the halving is the whole reason the endless half is worth having.
 *
 * It was written at 15% first — the same notch, on the theory that a repeated
 * rung repeating something *else* would be a new rule wearing a number, and the
 * ladder cannot owe the player ninety explanations. Compounding settled it. At
 * 1.15 the climb ran out in about five rungs: 5.7 antes cleared at A10, 2.2 at
 * A15, nothing alive by A22 — a scoreboard with five marks on it. At 1.08 the
 * same bot spans sixteen: 5.54 antes at A10, 4.75 at A14, 3.28 at A18, 2.48 at
 * A20, 1.10 by A26, with wins still turning up as high as A20. About a quarter
 * of an ante a rung.
 *
 * Which is the property being bought. A rung has to be small enough that taking
 * the next one is a decision rather than a coin flip, and a ladder meant to be
 * the game's own win condition needs somewhere to put the players who are
 * better at this than the harness is.
 */
const ENDLESS_STEP = 1.08

/**
 * A ceiling on the dial, not a top to the ladder.
 *
 * The endless half is endless in the sense that matters — nobody is going to
 * exhaust it — but a number that a save can carry and a stepper can walk needs
 * *some* bound, or a hand-edited record could ask for a target of Infinity and
 * get a run with no legal outcome. A hundred is far past anything survivable:
 * rung 100 carries 1.08^90 on top of Steeper's own 15%, which is a little over a
 * thousand times the authored curve, on a ladder where the measured climb dies
 * somewhere in the twenties.
 */
export const MAX_ASCENSION = 100

/**
 * What a level actually means, for a screen that has to explain the choice.
 *
 * Synthesised above the authored ladder rather than stored, because storing
 * ninety near-identical entries would be a list nobody could read and a codex
 * nobody could scroll. The synthesised rung says what it does and what it has
 * come to in total, since "another 15%" stops being useful information around
 * the third time it is said.
 */
export function ascensionAt(level: number): Ascension | undefined {
  const authored = ASCENSIONS.find((rule) => rule.level === level)
  if (authored) return authored
  if (!Number.isInteger(level) || level <= AUTHORED_ASCENSIONS || level > MAX_ASCENSION) {
    return undefined
  }
  const total = difficultyAt(level).targets
  return {
    level,
    name: "Steeper",
    text: `Targets rise another ${Math.round((ENDLESS_STEP - 1) * 100)}% — ×${total.toFixed(2)} in all.`,
    targets: ENDLESS_STEP,
  }
}

/** A level anyone can be at: whole, not negative, not past the dial. */
export const clampAscension = (level: number): number =>
  Number.isFinite(level) ? Math.min(MAX_ASCENSION, Math.max(0, Math.floor(level))) : 0

/**
 * Everything the ladder bends about a run, folded into one object.
 *
 * One fold rather than a lookup at each call site, and that is the whole reason
 * this type exists. The alternative — `rulesFor(state).some(…)` wherever a
 * number is needed — worked while the only bend was `solveRequired`, and would
 * have meant the reducer asking the ladder five separate questions about five
 * separate fields, none of which could account for the endless half without
 * inventing ninety `Ascension` records to iterate over.
 */
export type Difficulty = {
  /** Multiplier on every blind's target. */
  targets: number
  /** Gold off every blind's base payout. */
  payoutCut: number
  /** Jokers the tray holds. */
  jokerSlots: number
  /** The blind's guess allowance, before a boss tightens it. */
  guesses: number
  /** Whether a blind at target but unsolved is still a loss. */
  mustSolve: boolean
}

/** The terms of a run at a level. Pure in the level, so nothing caches it. */
export function difficultyAt(level: number): Difficulty {
  const at = clampAscension(level)
  const difficulty: Difficulty = {
    targets: 1,
    payoutCut: 0,
    jokerSlots: JOKER_SLOTS,
    guesses: BASE_GUESSES,
    mustSolve: false,
  }
  for (const rule of ASCENSIONS) {
    if (rule.level > at) break
    difficulty.targets *= rule.targets ?? 1
    difficulty.payoutCut += rule.payoutCut ?? 0
    difficulty.jokerSlots -= rule.jokerCut ?? 0
    difficulty.guesses -= rule.guessCut ?? 0
    difficulty.mustSolve ||= rule.solveRequired ?? false
  }
  difficulty.targets *= ENDLESS_STEP ** Math.max(0, at - AUTHORED_ASCENSIONS)
  return difficulty
}

/** The same, read off a run. Absent means zero, which means the plain game. */
export const difficultyOf = (state: RunState): Difficulty => difficultyAt(state.ascension ?? 0)

/**
 * A scaled target, rounded to a readable number.
 *
 * To the nearest ten rather than the nearest hundred `blindTargets` uses,
 * because 15% of the first target is 45 and rounding that to 0 or 100 would make
 * the first rung of the endless half either free or twice what it says. Ten is
 * fine enough to keep every rung distinct and coarse enough that the number on
 * the card still reads as a target rather than as a computation.
 */
export const scaleTarget = (target: number, scale: number): number =>
  scale === 1 ? target : Math.round((target * scale) / 10) * 10

/**
 * The rules a run is playing under, for the screens that name them.
 *
 * Authored only. The endless rungs are deliberately not here: they carry no
 * `validate` and no `solveRequired`, so they would change nothing about a guess,
 * and a run at ascension 30 would list twenty entries of "Steeper" on its intro
 * card. What the endless half does is a number, and the screens say the number.
 */
export function rulesFor(state: RunState): readonly Ascension[] {
  const level = state.ascension ?? 0
  return level > 0 ? ASCENSIONS.filter((rule) => rule.level <= level) : []
}

/** Ascension 10: a blind at target but unsolved is still a loss. */
export const mustSolve = (state: RunState): boolean => difficultyOf(state).mustSolve

/**
 * Every rule the guess has to survive, in one place and one order.
 *
 * The order is by scope: the run's rules before the blind's, and within the
 * run's, the order they were learned. A player who breaks two rules at once
 * gets told about the one that holds every blind of the run rather than the one
 * that expires with this boss, and — the part that actually matters — gets told
 * the *same* thing every time, because the sequence never depends on which rule
 * happened to be checked first.
 */
export function validateGuess(word: string, state: RunState): string | null {
  for (const rule of rulesFor(state)) {
    const refusal = rule.validate?.(word, state)
    if (refusal) return refusal
  }
  return getBoss(state.blind.bossId)?.validate?.(word, state.blind) ?? null
}

/** Whether anything at all is restricting what may be typed this blind. */
export const guessRestricted = (state: RunState): boolean =>
  Boolean(getBoss(state.blind.bossId)?.validate) || rulesFor(state).some((rule) => rule.validate)
