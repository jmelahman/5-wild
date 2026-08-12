import {
  ANTES,
  BASE_GUESSES,
  BLIND_PAYOUT,
  blindTargets,
  CONSUMABLE_SLOTS,
  GOLD_PER_UNUSED_GUESS,
  INTEREST_CAP,
  INTEREST_PER,
  JOKER_SLOTS,
  STARTING_GOLD,
} from "../content/blinds"
import { ALPHABET } from "../content/letters"
import type { Boss } from "./bosses"
import { bossForAnte, getBoss } from "./bosses"
import { CONSUMABLE_BY_ID } from "./consumables"
import type { Joker, JokerCtx } from "./jokers"
import { JOKER_BY_ID } from "./jokers"
import type { Rng } from "./rng"
import { derive, pick } from "./rng"
import { scoreGuess } from "./scoring"
import { rerollCost, rollShop, sellValue } from "./shop"
import type {
  Action,
  BlindIndex,
  BlindState,
  GameEvent,
  LetterState,
  Reduced,
  RunState,
  WordSource,
} from "./state"
import { computeFeedback, toTiles } from "./words"

/**
 * The whole game, as one function.
 *
 *   reduce(state, action, words) -> { state, events }
 *
 * No I/O, no clock, no ambient randomness. The state is never mutated in
 * place — callers can hold onto the old one, which is what makes undo, replay
 * and the golden vectors possible.
 */

/**
 * RunState is plain JSON by construction, so this is both the cheapest correct
 * deep clone and a standing assertion that it stayed that way: the day someone
 * puts a Map or a Date in the state, saves break here first and loudly.
 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * Every equipped joker paired with the context its run-level hooks get.
 *
 * One `Rng` shared across the slots rather than one each, so the draws stay in
 * slot order and a joker bought later cannot shift what an earlier one rolled.
 */
function jokerHooks(
  state: RunState,
  rng: Rng,
  events: GameEvent[],
): Array<readonly [Joker, JokerCtx]> {
  const out: Array<readonly [Joker, JokerCtx]> = []
  state.jokers.forEach((instance, slot) => {
    const joker = JOKER_BY_ID.get(instance.id)
    if (joker) out.push([joker, { state, instance, slot, rng, events }])
  })
  return out
}

function freshLetters(): Record<string, LetterState> {
  const letters: Record<string, LetterState> = {}
  for (const letter of ALPHABET) letters[letter] = { etch: 0, destroyed: false, mod: null }
  return letters
}

/**
 * Answers must avoid destroyed letters, or a burnt keyboard could be handed a
 * word it cannot type. If burning ever narrows the pool to nothing the alphabet
 * heals rather than dead-ends the run — unreachable in practice, since
 * Pyromaniac refuses to burn below fifteen live letters.
 *
 * The answer must also be a legal guess under the boss's own rule. The Glutton
 * demands two vowels of every guess, and roughly a fifth of the answer list has
 * only one — drawing such a word would make the blind literally unsolvable.
 */
function answerPool(state: RunState, words: WordSource, boss: Boss | undefined): readonly string[] {
  const dead = [...ALPHABET].filter((letter) => state.letters[letter]?.destroyed)
  const validate = boss?.validate
  if (dead.length === 0 && !validate) return words.answers

  const legal = (word: string) =>
    ![...word].some((letter) => dead.includes(letter)) &&
    (!validate || validate(word, state.blind) === null)

  const pool = words.answers.filter(legal)
  if (pool.length > 0) return pool

  // Nothing survives both filters, so the keyboard heals rather than dead-ends
  // the run. The boss rule does not heal with it: an answer that cannot legally
  // be guessed is an unwinnable blind, which is worse than an easy one.
  for (const letter of ALPHABET) {
    const entry = state.letters[letter]
    if (entry) entry.destroyed = false
  }
  if (!validate) return words.answers
  const healed = words.answers.filter((word) => validate(word, state.blind) === null)
  return healed.length > 0 ? healed : words.answers
}

function beginBlind(state: RunState, words: WordSource, events: GameEvent[]): void {
  const bossId = state.blindIndex === 2 ? bossForAnte(state) : null

  // Blind-start hooks run before the answer is drawn, so a joker that shrinks
  // the alphabet actually shrinks the search space too.
  const rng = derive(state.seed, "blind_start", state.ante, state.blindIndex)
  for (const [joker, ctx] of jokerHooks(state, rng, events)) joker.onBlindStart?.(ctx)

  const boss = getBoss(bossId)

  // The empty blind is installed before the answer is drawn, so boss rules that
  // read the round's history — The Tyrant reads its greens — judge candidate
  // answers against this round rather than the one just finished.
  state.blind = {
    answer: "",
    target: blindTargets(state.ante)[state.blindIndex],
    maxGuesses: boss?.maxGuesses ?? BASE_GUESSES,
    bossId,
    draft: "",
    guesses: [],
    score: 0,
    solved: false,
    done: false,
    revealed: [],
    eliminated: [],
    promote: false,
  }

  const answer = pick(
    derive(state.seed, "word", state.ante, state.blindIndex),
    answerPool(state, words, boss),
  )
  state.blind.answer = answer
  state.blind.revealed = Array.from(answer, () => null)

  state.phase = "blind"
  state.reward = null
  state.shop = null
}

/** The single fail state: score below target when the blind ends. */
function resolveBlind(state: RunState, events: GameEvent[]): void {
  const blind = state.blind

  // Before the win/lose branch, so a joker that grows on a blind ending counts
  // the blind that ended — including the one that ended the run. Losing makes
  // that moot rather than wrong, and the alternative is a hook whose firing
  // depends on an outcome it might itself be about to read.
  const rng = derive(state.seed, "blind_end", state.ante, state.blindIndex)
  for (const [joker, ctx] of jokerHooks(state, rng, events)) joker.onBlindEnd?.(ctx, blind)

  if (blind.score < blind.target) {
    state.phase = "game_over"
    events.push({ type: "blind_lost" })
    return
  }

  // Paying for unused guesses is the counterweight to chip-farming: the economy
  // rewards exactly the restraint the scoring punishes.
  const base = BLIND_PAYOUT[state.blindIndex]
  const unusedGuesses = (blind.maxGuesses - blind.guesses.length) * GOLD_PER_UNUSED_GUESS
  const interest = Math.min(INTEREST_CAP, Math.floor(state.gold / INTEREST_PER))

  state.reward = { base, unusedGuesses, interest, total: base + unusedGuesses + interest }
  state.phase = "reward"
  events.push({ type: "blind_won" })
}

const PLACEHOLDER_BLIND: BlindState = {
  answer: "",
  target: 0,
  maxGuesses: BASE_GUESSES,
  bossId: null,
  draft: "",
  guesses: [],
  score: 0,
  solved: false,
  done: false,
  revealed: [],
  eliminated: [],
  promote: false,
}

export function startRun(seed: number, words: WordSource): Reduced {
  const state: RunState = {
    seed,
    ante: 1,
    blindIndex: 0,
    phase: "blind",
    gold: STARTING_GOLD,
    jokers: [],
    consumables: [],
    letters: freshLetters(),
    blind: clone(PLACEHOLDER_BLIND),
    shop: null,
    reward: null,
  }
  const events: GameEvent[] = []
  beginBlind(state, words, events)
  return { state, events }
}

export function reduce(state: RunState, action: Action, words: WordSource): Reduced {
  const events: GameEvent[] = []
  const next = clone(state)

  /** Refusals leave the original state untouched — the UI just flashes a reason. */
  const reject = (reason: string): Reduced => ({ state, events: [{ type: "rejected", reason }] })

  switch (action.type) {
    case "start_run":
      return startRun(action.seed, words)

    case "type_letter": {
      const blind = next.blind
      if (next.phase !== "blind" || blind.done) return reject("not your turn")
      const letter = action.letter.toLowerCase()
      if (letter.length !== 1 || !ALPHABET.includes(letter)) return reject("not a letter")
      if (next.letters[letter]?.destroyed) return reject(`${letter.toUpperCase()} is burnt out`)
      if (blind.draft.length >= blind.answer.length) return reject("no room")
      blind.draft += letter
      return { state: next, events }
    }

    case "backspace": {
      const blind = next.blind
      if (next.phase !== "blind" || blind.done) return reject("not your turn")
      blind.draft = blind.draft.slice(0, -1)
      return { state: next, events }
    }

    case "submit": {
      const blind = next.blind
      if (next.phase !== "blind" || blind.done) return reject("not your turn")

      const word = blind.draft
      if (word.length !== blind.answer.length) return reject(`${blind.answer.length} letters`)
      if (!words.allowed.has(word)) return reject("not in word list")

      const boss = getBoss(blind.bossId)
      const refusal = boss?.validate?.(word, blind)
      if (refusal) return reject(refusal)

      const tiles = toTiles(word, computeFeedback(word, blind.answer))
      boss?.transform?.(tiles)

      // After the boss, so The Magician is a genuine counter to The Silence
      // rather than something it quietly erases.
      if (blind.promote) {
        const gray = tiles.find((tile) => tile.color === "gray")
        if (gray) {
          gray.color = "yellow"
          gray.shown = "yellow"
        }
        blind.promote = false
      }

      const solved = word === blind.answer
      const guessIndex = blind.guesses.length
      const guessesLeft = blind.maxGuesses - guessIndex - 1
      const result = scoreGuess({
        state: next,
        tiles,
        word,
        guessIndex,
        guessesLeft,
        solved,
        events,
      })

      blind.guesses.push({
        word,
        tiles,
        chips: result.chips,
        mult: result.mult,
        solveBonus: result.solveBonus,
        score: result.score,
      })
      blind.score += result.score
      blind.draft = ""

      // A glass letter that shattered goes out of the alphabet here rather than
      // mid-pipeline: scoring prices the guess, this owns the run. It lands
      // before the total so the break reads as part of the guess that caused it.
      for (const letter of result.burned) {
        const entry = next.letters[letter]
        if (!entry || entry.destroyed) continue
        entry.destroyed = true
        events.push({ type: "letter_destroyed", letter })
      }

      // Same discipline as the burns above: scoring decided what each joker
      // grew to, and this is where growing becomes part of the run.
      for (const { slot, data } of result.jokerData) {
        const instance = next.jokers[slot]
        if (instance) instance.data = data
      }

      if (result.gold > 0) {
        next.gold += result.gold
        events.push({ type: "gold", delta: result.gold, reason: "scoring" })
      }
      events.push({ type: "guess_scored", score: result.score, total: blind.score })

      // The solve bonus lands on the running total, after the guess is banked —
      // so it multiplies the farming as well as the finish. Emitted last
      // because that is the order it reads on screen: the guess scores, then
      // the whole pile multiplies.
      if (solved && result.solveBonus > 1) {
        blind.score = Math.round(blind.score * result.solveBonus)
        events.push({ type: "solve_bonus", factor: result.solveBonus, total: blind.score })
      }

      if (solved) blind.solved = true
      // Solving ends the blind on the spot, forfeiting every unplayed guess.
      if (solved || blind.guesses.length >= blind.maxGuesses) {
        blind.done = true
        resolveBlind(next, events)
      }
      return { state: next, events }
    }

    case "use_consumable": {
      if (next.phase !== "blind") return reject("only during a blind")
      const instance = next.consumables[action.index]
      if (!instance) return reject("no such card")
      const card = CONSUMABLE_BY_ID.get(instance.id)
      if (!card) return reject("unknown card")

      const rng = derive(
        next.seed,
        "consumable",
        next.ante,
        next.blindIndex,
        next.blind.guesses.length,
        action.index,
      )
      const problem = card.apply(next, rng, events)
      if (problem) return reject(problem)

      next.consumables.splice(action.index, 1)
      return { state: next, events }
    }

    case "collect": {
      if (next.phase !== "reward" || !next.reward) return reject("nothing to collect")
      next.gold += next.reward.total
      events.push({ type: "gold", delta: next.reward.total, reason: "blind cleared" })

      if (next.ante >= ANTES && next.blindIndex === 2) {
        next.phase = "victory"
        events.push({ type: "run_won" })
        return { state: next, events }
      }

      // Before the roll, so a joker that bends the shop bends the one it is
      // about to be shown rather than the next one.
      const shopRng = derive(next.seed, "shop_enter", next.ante, next.blindIndex)
      for (const [joker, ctx] of jokerHooks(next, shopRng, events)) joker.onShopEnter?.(ctx)

      next.shop = rollShop(next, derive(next.seed, "shop", next.ante, next.blindIndex, 0), 0)
      next.phase = "shop"
      events.push({ type: "shop_entered" })
      return { state: next, events }
    }

    case "buy": {
      if (next.phase !== "shop" || !next.shop) return reject("not in the shop")
      const item = next.shop.items[action.index]
      if (!item) return reject("already bought")
      if (next.gold < item.cost) return reject("not enough gold")

      switch (item.kind) {
        case "joker": {
          if (next.jokers.length >= JOKER_SLOTS) return reject("no joker slots free")
          next.jokers.push({ id: item.id })
          break
        }
        case "consumable": {
          if (next.consumables.length >= CONSUMABLE_SLOTS) return reject("no card slots free")
          next.consumables.push({ id: item.id })
          break
        }
        case "etch": {
          const entry = next.letters[item.letter]
          if (!entry) return reject("unknown letter")
          entry.etch += 1
          break
        }
        case "mod": {
          const entry = next.letters[item.letter]
          if (!entry) return reject("unknown letter")
          // A letter holds one modifier, so this replaces rather than stacks —
          // the shop card says so before the gold is spent.
          entry.mod = item.id
          break
        }
      }

      next.gold -= item.cost
      next.shop.items[action.index] = null
      events.push({ type: "gold", delta: -item.cost, reason: "purchase" })
      return { state: next, events }
    }

    case "sell_joker": {
      if (next.phase !== "shop") return reject("you can only sell in the shop")
      const instance = next.jokers[action.index]
      if (!instance) return reject("no such joker")
      const value = sellValue(JOKER_BY_ID.get(instance.id)?.cost ?? 4)
      next.jokers.splice(action.index, 1)
      next.gold += value
      events.push({ type: "gold", delta: value, reason: "sold" })
      return { state: next, events }
    }

    case "reroll": {
      if (next.phase !== "shop" || !next.shop) return reject("not in the shop")
      const cost = rerollCost(next.shop)
      if (next.gold < cost) return reject("not enough gold")
      next.gold -= cost

      const rerolls = next.shop.rerolls + 1
      next.shop = rollShop(
        next,
        derive(next.seed, "shop", next.ante, next.blindIndex, rerolls),
        rerolls,
      )
      events.push({ type: "gold", delta: -cost, reason: "reroll" })
      return { state: next, events }
    }

    case "next_blind": {
      if (next.phase !== "shop") return reject("not in the shop")
      if (next.blindIndex === 2) {
        next.ante += 1
        next.blindIndex = 0
      } else {
        next.blindIndex = (next.blindIndex + 1) as BlindIndex
      }

      if (next.ante > ANTES) {
        next.phase = "victory"
        events.push({ type: "run_won" })
        return { state: next, events }
      }

      beginBlind(next, words, events)
      return { state: next, events }
    }
  }
}
