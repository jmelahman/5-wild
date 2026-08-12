import type { BlindState } from "./state"

/**
 * The primitives that guess rules are built out of.
 *
 * Bosses and ascensions both restrict what may be typed, and they overlap by
 * design — ascension 5 *is* The Tyrant. Sharing the implementation is what keeps
 * the two from drifting into two slightly different definitions of the same
 * sentence, which the player would experience as the rule changing meaning
 * depending on which system happened to impose it.
 *
 * Every one of these reads `tile.color`, what actually happened, rather than
 * `tile.shown`, what the board displayed. That is load-bearing rather than
 * incidental: a rule derived from real feedback is one the answer itself always
 * satisfies, so the answer is always a legal guess and no blind can be argued
 * into being unwinnable. Built on `shown` instead, The Mirror — which moves
 * feedback to positions it did not come from — could demand a letter that is in
 * no word at all, and the player would simply be unable to submit anything.
 *
 * The cost is that a lying boss makes the refusal message say more than the
 * board does. That is the right way round: a rule that cannot be satisfied is
 * broken, a rule that gives something away is merely generous.
 */

/** Positions the player has already locked in green. */
export function knownGreens(blind: BlindState): Map<number, string> {
  const found = new Map<number, string>()
  for (const guess of blind.guesses) {
    guess.tiles.forEach((tile, i) => {
      if (tile.color === "green") found.set(i, tile.letter)
    })
  }
  return found
}

/**
 * Letters proven to be in the word.
 *
 * `only` narrows it to one colour, because the ascension ladder demands yellows
 * two steps before it demands greens and the two have to be askable apart.
 * Insertion order is guess order, then tile order, which is what makes the
 * refusal a player sees for a given board the same one every time.
 */
export function found(blind: BlindState, only?: "green" | "yellow"): Set<string> {
  const letters = new Set<string>()
  for (const guess of blind.guesses) {
    for (const tile of guess.tiles) {
      if (tile.color === "gray") continue
      if (!only || tile.color === only) letters.add(tile.letter)
    }
  }
  return letters
}

/** Every proven letter has to appear somewhere in the guess. */
export function useFound(word: string, letters: Iterable<string>): string | null {
  for (const letter of letters) {
    if (!word.includes(letter)) return `must use ${letter.toUpperCase()}`
  }
  return null
}

/** Every green has to stay exactly where it was found. The Tyrant, and ascension 5. */
export function keepGreens(word: string, blind: BlindState): string | null {
  for (const [i, letter] of knownGreens(blind)) {
    if (word[i] !== letter) return `must keep ${letter.toUpperCase()} in position ${i + 1}`
  }
  return null
}
