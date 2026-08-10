/**
 * Letter chip values — rarity-inverse, Scrabble-like.
 *
 * This table is where the game's central tension is born. AROSE is 5 chips and
 * a superb opening probe; JAZZY is 33 chips and deduction poison. The player
 * feels the conflict between "guess well" and "score well" on turn one.
 *
 * Written as groups rather than 26 entries so the shape of the curve stays
 * readable, and so the formatter cannot explode it into a wall of lines.
 */
const CHIP_GROUPS: ReadonlyArray<readonly [number, string]> = [
  [1, "aeioulnstr"],
  [2, "dg"],
  [3, "bcmp"],
  [4, "fhvwy"],
  [5, "k"],
  [8, "jx"],
  [10, "qz"],
]

export const LETTER_CHIPS: Readonly<Record<string, number>> = Object.fromEntries(
  CHIP_GROUPS.flatMap(([chips, letters]) => [...letters].map((letter) => [letter, chips])),
)

export const ALPHABET = "abcdefghijklmnopqrstuvwxyz"
export const VOWELS = "aeiou"

export const isVowel = (letter: string): boolean => VOWELS.includes(letter)
