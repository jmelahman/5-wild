import { LETTER_CHIPS } from "../content/letters"
import { getBoss } from "./bosses"
import { JOKER_BY_ID } from "./jokers"
import type { GameEvent, RunState, Tile } from "./state"

/**
 * The scoring pipeline.
 *
 *   per tile, left to right:  base chips + colour mult, then every joker's
 *                             onTile hook in slot order
 *   after the tiles:          every joker's onGuess hook in slot order
 *   finally:                  the solve bonus
 *
 * Jokers get real code rather than a data-driven effect DSL, because a DSL
 * always hits a wall around the tenth joker. What they get instead is a narrow
 * mutable context and a fixed firing order, which keeps them deterministic and
 * individually testable.
 *
 * The left-to-right tile cadence is not incidental: it is the animation, so the
 * event log doubles as the storyboard.
 */

export type ScoreCtx = {
  readonly state: RunState
  readonly word: string
  readonly tiles: readonly Tile[]
  /** 0-based index of this guess within the blind. */
  readonly guessIndex: number
  /** Guesses that would remain after this one. */
  readonly guessesLeft: number
  readonly solved: boolean
  chips: number
  mult: number
  gold: number
  addChips(amount: number): void
  addMult(amount: number): void
  timesMult(factor: number): void
  addGold(amount: number): void
  /** The chip value a letter is worth right now, etchings included. */
  baseChipsOf(letter: string): number
}

export type ScoreResult = {
  chips: number
  mult: number
  solveBonus: number
  score: number
  gold: number
}

export function baseChips(state: RunState, letter: string): number {
  return (LETTER_CHIPS[letter] ?? 0) + (state.letters[letter]?.etch ?? 0)
}

/** Green is worth three of these, yellow one. Gray is worth nothing, on purpose. */
const MULT_FOR_COLOR = { green: 3, yellow: 1, gray: 0 } as const

export function scoreGuess(params: {
  state: RunState
  tiles: readonly Tile[]
  word: string
  guessIndex: number
  guessesLeft: number
  solved: boolean
  events: GameEvent[]
}): ScoreResult {
  const { state, tiles, word, guessIndex, guessesLeft, solved, events } = params
  const blind = state.blind
  const boss = getBoss(blind.bossId)

  let firing: { slot: number; id: string } | null = null
  const fire = (label: string) => {
    if (!firing) return
    events.push({
      type: "joker",
      slot: firing.slot,
      id: firing.id,
      label,
      chips: ctx.chips,
      mult: ctx.mult,
    })
  }

  const ctx: ScoreCtx = {
    state,
    word,
    tiles,
    guessIndex,
    guessesLeft,
    solved,
    chips: 0,
    mult: 1,
    gold: 0,
    baseChipsOf: (letter) => baseChips(state, letter),
    addChips(amount) {
      ctx.chips += amount
      fire(`+${amount}`)
    },
    addMult(amount) {
      ctx.mult += amount
      fire(`+${amount} mult`)
    },
    timesMult(factor) {
      ctx.mult *= factor
      fire(`×${factor} mult`)
    },
    addGold(amount) {
      ctx.gold += amount
      fire(`+$${amount}`)
    },
  }

  const jokers = state.jokers.map((instance) => JOKER_BY_ID.get(instance.id))

  tiles.forEach((tile, index) => {
    const base = boss?.tileChips
      ? boss.tileChips(baseChips(state, tile.letter), tile, blind)
      : baseChips(state, tile.letter)

    ctx.chips += base
    ctx.mult += MULT_FOR_COLOR[tile.color]
    events.push({ type: "tile", index, gained: base, chips: ctx.chips, mult: ctx.mult })

    jokers.forEach((joker, slot) => {
      if (!joker?.onTile) return
      firing = { slot, id: joker.id }
      joker.onTile(ctx, tile, index, base)
      firing = null
    })
  })

  jokers.forEach((joker, slot) => {
    if (!joker?.onGuess) return
    firing = { slot, id: joker.id }
    joker.onGuess(ctx)
    firing = null
  })

  // Solving pays tempo and ends the blind on the spot. Cashing out early is
  // worth more than farming — right up until it isn't. That is the whole game.
  const solveBonus = solved ? 1 + guessesLeft : 1
  if (solved && solveBonus > 1) events.push({ type: "solve_bonus", factor: solveBonus })

  return {
    chips: ctx.chips,
    mult: ctx.mult,
    solveBonus,
    score: Math.round(ctx.chips * ctx.mult * solveBonus),
    gold: ctx.gold,
  }
}
