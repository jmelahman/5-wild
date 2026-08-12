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
 * ordered curve, one new thing to learn per step, and six configurations to
 * verify instead of sixty-three.
 *
 * Four of the six are guess rules and share their machinery with the bosses,
 * which is the point: a boss is a rule for one blind, an ascension is the same
 * kind of rule for a whole run, and the sixth is not a guess rule at all.
 *
 * They stack in roughly the order they hurt. The last one is the sharpest thing
 * in the game: it deletes farming-and-failing-out as a line entirely.
 */
export type Ascension = {
  /** The level this arrives at. A run at level N plays every rule at or below N. */
  level: number
  name: string
  /** The rule in words, for the screen that has to sell it before it is chosen. */
  text: string
  /** A rejection reason, or null to allow the guess. */
  validate?: (word: string, state: RunState) => string | null
  /** Ascension 6 alone: clearing the target stops being enough. */
  solveRequired?: true
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
    name: "Finish It",
    text: "Reaching the target is not enough. You have to solve the word.",
    // The sharpest of the six, and the reason it is last. Every other blind in
    // the game can be won by farming chips off five wrong guesses and never
    // finding the answer; this deletes that line, and with it the whole
    // deduction-versus-greed hedge. The word is the point again.
    solveRequired: true,
  },
]

/** The hardest run on offer. */
export const MAX_ASCENSION = ASCENSIONS.length

/** What a level actually means, for a screen that has to explain the choice. */
export const ascensionAt = (level: number): Ascension | undefined =>
  ASCENSIONS.find((rule) => rule.level === level)

/** A level anyone can be at: whole, not negative, not past the ladder. */
export const clampAscension = (level: number): number =>
  Number.isFinite(level) ? Math.min(MAX_ASCENSION, Math.max(0, Math.floor(level))) : 0

/** The rules a run is playing under. Absent means zero, which means none. */
export function rulesFor(state: RunState): readonly Ascension[] {
  const level = state.ascension ?? 0
  return level > 0 ? ASCENSIONS.filter((rule) => rule.level <= level) : []
}

/** Ascension 6: a blind at target but unsolved is still a loss. */
export const mustSolve = (state: RunState): boolean =>
  rulesFor(state).some((rule) => rule.solveRequired)

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
