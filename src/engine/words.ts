import type { Color, Tile } from "./state"

/**
 * Wordle's colouring, including the part everyone gets wrong the first time:
 * duplicate letters. Greens are claimed first, then yellows draw only from the
 * copies left over. Guessing LOLLY against SILLY marks the leading L *gray* —
 * both of the answer's Ls are already spoken for by the two green ones. A
 * single pass cannot produce that; hence two.
 */
export function computeFeedback(guess: string, answer: string): Color[] {
  const colors: Color[] = Array.from(guess, () => "gray")
  const remaining = new Map<string, number>()

  for (const letter of answer) remaining.set(letter, (remaining.get(letter) ?? 0) + 1)

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) {
      colors[i] = "green"
      const letter = guess[i]
      if (letter !== undefined) remaining.set(letter, (remaining.get(letter) ?? 0) - 1)
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (colors[i] === "green") continue
    const letter = guess[i]
    if (letter === undefined) continue
    const left = remaining.get(letter) ?? 0
    if (left > 0) {
      colors[i] = "yellow"
      remaining.set(letter, left - 1)
    }
  }

  return colors
}

/**
 * `color` drives scoring, `shown` drives the screen. They are equal except when
 * a boss lies to the player — The Fog hides yellows without disarming them.
 */
export function toTiles(guess: string, colors: readonly Color[]): Tile[] {
  return Array.from(guess, (letter, i) => {
    const color = colors[i] ?? "gray"
    return { letter, color, shown: color }
  })
}

/** The best colour known for each letter so far, for painting the keyboard. */
export function keyboardColors(guesses: ReadonlyArray<{ tiles: readonly Tile[] }>) {
  const rank: Record<Color, number> = { gray: 0, yellow: 1, green: 2 }
  const best = new Map<string, Color>()
  for (const guess of guesses) {
    for (const tile of guess.tiles) {
      const current = best.get(tile.letter)
      if (current === undefined || rank[tile.shown] > rank[current]) {
        best.set(tile.letter, tile.shown)
      }
    }
  }
  return best
}
