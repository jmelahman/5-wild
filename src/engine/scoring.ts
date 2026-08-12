import { ALPHABET, LETTER_CHIPS, MIN_LIVE_LETTERS, MULT_FOR_COLOR } from "../content/letters"
import { getBoss } from "./bosses"
import { JOKER_BY_ID } from "./jokers"
import type { ModCtx } from "./modifiers"
import { modifierOf } from "./modifiers"
import type { Rng } from "./rng"
import { derive } from "./rng"
import type { GameEvent, RunState, Tile } from "./state"

/**
 * The scoring pipeline.
 *
 *   per tile, left to right:  base chips + colour mult, then the letter's own
 *                             modifier, then every joker's onTile hook in slot
 *                             order
 *   after the tiles:          every joker's onGuess hook in slot order
 *   finally:                  the solve bonus
 *
 * The modifier goes before the jokers because the letter is what was played and
 * the jokers are what watched it — and because a ×mult modifier landing before
 * the jokers' flat mult is the weaker, more governable half of that ordering.
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
  /**
   * A seeded roll for whatever is currently firing, in [0, 1). Chance effects
   * have to replay identically from a save and from a golden vector, so this is
   * the only randomness an effect may consult. Each hook gets its own stream,
   * keyed by where it fired rather than by the order things ran in.
   */
  roll(): number
  /**
   * This joker's own persistent counter, 0 if it has never written one. Reads
   * what the joker has grown to *including* anything written earlier in this
   * same guess.
   */
  getData(key: string): number
  /**
   * Grow this joker. Collected rather than applied: scoring prices a guess, it
   * does not edit the run — the same rule that puts `burned` in the result
   * instead of mutating `state.letters` here. The caller commits it.
   */
  setData(key: string, value: number): void
}

export type ScoreResult = {
  chips: number
  mult: number
  solveBonus: number
  score: number
  gold: number
  /**
   * Letters a shattering modifier retired. Applied by the caller rather than
   * here: scoring prices a guess, it does not edit the run.
   */
  burned: string[]
  /**
   * Jokers that grew this guess, by slot. Same discipline as `burned` — only
   * the slots that actually wrote appear, so committing this never plants an
   * empty `data` on a joker that does not scale.
   */
  jokerData: Array<{ slot: number; data: Record<string, number> }>
}

export function baseChips(state: RunState, letter: string): number {
  return (LETTER_CHIPS[letter] ?? 0) + (state.letters[letter]?.etch ?? 0)
}

/**
 * What solving right now would multiply the blind's pile by.
 *
 * Deliberately a pure function of the state rather than something assembled
 * mid-pipeline: the board shows this figure *before* the guess is submitted, and
 * a readout that disagreed with the rule would be worse than no readout at all.
 * So jokers touch it through their own hook instead of through `ScoreCtx` — a
 * bonus that could only be known by scoring a guess could not be predicted.
 *
 * The boss goes last so a cap really caps.
 *
 * @param guessesLeft guesses that would remain *after* the solving guess.
 */
export function solveBonusFor(state: RunState, guessesLeft: number): number {
  let bonus = 1 + guessesLeft
  for (const instance of state.jokers) {
    bonus += JOKER_BY_ID.get(instance.id)?.solveBonus?.(state) ?? 0
  }
  const boss = getBoss(state.blind.bossId)
  return boss?.solveBonus ? boss.solveBonus(bonus, state.blind) : bonus
}

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

  /**
   * Whoever is currently firing gets to narrate what it did. Set around each
   * hook call, so an effect only has to say `+4 mult` and the event it lands in
   * — a joker card lighting up, or the tile whose letter carried a modifier —
   * is decided by the caller.
   */
  let firing: ((label: string) => void) | null = null
  const fire = (label: string) => firing?.(label)

  /** The firing hook's own seeded stream, replaced around each hook call. */
  let roll: Rng = () => 0

  const burned: string[] = []

  /**
   * Which joker slot is firing, so `setData` knows whose counter it is writing.
   * Null while a modifier or the tile loop itself is running — a letter has no
   * slot to grow in.
   */
  let slotFiring: number | null = null
  const grown = new Map<number, Record<string, number>>()

  /** Copy-on-write, so a slot only lands in the result once it actually grows. */
  const bucketFor = (slot: number): Record<string, number> => {
    const existing = grown.get(slot)
    if (existing) return existing
    const fresh = { ...(state.jokers[slot]?.data ?? {}) }
    grown.set(slot, fresh)
    return fresh
  }

  const ctx: ModCtx = {
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
    roll: () => roll(),
    getData(key) {
      if (slotFiring === null) return 0
      // Reads through to what this guess has already written, so a joker that
      // grows and then spends its own counter in the same guess sees the new
      // value rather than a stale one.
      const bucket = grown.get(slotFiring)
      if (bucket) return bucket[key] ?? 0
      return state.jokers[slotFiring]?.data?.[key] ?? 0
    },
    setData(key, value) {
      if (slotFiring === null) return
      bucketFor(slotFiring)[key] = value
    },
    burn(letter) {
      if (burned.includes(letter)) return
      // Counted against what the alphabet *will* be, so a guess that shatters
      // two letters cannot walk past the floor one letter at a time.
      const live = [...ALPHABET].filter(
        (name) => !state.letters[name]?.destroyed && !burned.includes(name),
      )
      if (live.length < MIN_LIVE_LETTERS) return
      burned.push(letter)
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

    const modifier = modifierOf(state, tile.letter)
    if (modifier) {
      // One stream per tile of one guess of one blind, so a chance effect is a
      // property of the position it happened at rather than of the order things
      // were drawn in — which is what lets a run be replayed from its seed.
      roll = derive(state.seed, "mod", state.ante, state.blindIndex, guessIndex, index)
      firing = (label) => {
        events.push({
          type: "mod",
          index,
          letter: tile.letter,
          id: modifier.id,
          label,
          chips: ctx.chips,
          mult: ctx.mult,
        })
      }
      modifier.onTile(ctx, tile)
      firing = null
    }

    jokers.forEach((joker, slot) => {
      if (!joker?.onTile) return
      // One stream per slot per tile, so a chance effect is a property of where
      // it fired rather than of the order the slots happened to run in — the
      // same rule the modifier stream above follows.
      roll = derive(state.seed, "joker", state.ante, state.blindIndex, guessIndex, slot, index)
      slotFiring = slot
      firing = (label) =>
        events.push({ type: "joker", slot, id: joker.id, label, chips: ctx.chips, mult: ctx.mult })
      joker.onTile(ctx, tile, index, base)
      firing = null
      slotFiring = null
    })
  })

  jokers.forEach((joker, slot) => {
    if (!joker?.onGuess) return
    // One coordinate shorter than the per-tile stream above, so the two cannot
    // collide even for the same slot and guess.
    roll = derive(state.seed, "joker", state.ante, state.blindIndex, guessIndex, slot)
    slotFiring = slot
    firing = (label) =>
      events.push({ type: "joker", slot, id: joker.id, label, chips: ctx.chips, mult: ctx.mult })
    joker.onGuess(ctx)
    firing = null
    slotFiring = null
  })

  // Solving pays tempo and ends the blind on the spot, and its bonus multiplies
  // everything banked this round rather than the guess that happened to land it.
  // So the two lines finally compose: farm the board up, then cash the whole
  // pile in at once. Deciding *when* is the game.
  //
  // The multiply itself belongs to the caller, which owns the running total —
  // this only prices it.
  const solveBonus = solved ? solveBonusFor(state, guessesLeft) : 1

  return {
    chips: ctx.chips,
    mult: ctx.mult,
    solveBonus,
    score: Math.round(ctx.chips * ctx.mult),
    gold: ctx.gold,
    burned,
    jokerData: [...grown].map(([slot, data]) => ({ slot, data })),
  }
}
