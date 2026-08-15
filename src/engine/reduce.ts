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
import { clampAscension, guessRestricted, mustSolve, validateGuess } from "./ascensions"
import { bossForAnte, getBoss } from "./bosses"
import { CATEGORY_BY_ID, levelOf } from "./categories"
import { CONSUMABLE_BY_ID } from "./consumables"
import { ETCHING_BY_ID } from "./etchings"
import type { Joker, JokerCtx } from "./jokers"
import { JOKER_BY_ID } from "./jokers"
import { MODIFIER_BY_ID } from "./modifiers"
import { PACK_BY_ID } from "./packs"
import { RANGE_BY_ID, rangeLevelOf } from "./ranges"
import type { Rng } from "./rng"
import { derive, pick } from "./rng"
import { scoreGuess } from "./scoring"
import { packContents, placeableLetters, rerollCost, rollShop, sellValue } from "./shop"
import type {
  Action,
  BlindIndex,
  BlindState,
  GameEvent,
  LetterState,
  Reduced,
  RunState,
  ShopItem,
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
 * The answer must also be a legal guess under every rule in force — the boss's
 * and the run's ascension both. The Glutton demands two vowels of every guess,
 * and roughly a fifth of the answer list has only one; ascension 3 forbids
 * repeating a word the run has already used, which would strand a blind on an
 * answer nobody is allowed to type. Either way the blind would be literally
 * unsolvable, so the filter is the same filter.
 *
 * It runs against the empty blind installed a moment ago, which is exactly right
 * for the rules that read the round's history: on a board with no guesses on it,
 * "keep the greens you found" is a rule about nothing and every word passes.
 */
function answerPool(state: RunState, words: WordSource): readonly string[] {
  const dead = [...ALPHABET].filter((letter) => state.letters[letter]?.destroyed)
  const restricted = guessRestricted(state)
  if (dead.length === 0 && !restricted) return words.answers

  const legal = (word: string) =>
    ![...word].some((letter) => dead.includes(letter)) &&
    (!restricted || validateGuess(word, state) === null)

  const pool = words.answers.filter(legal)
  if (pool.length > 0) return pool

  // Nothing survives both filters, so the keyboard heals rather than dead-ends
  // the run. The guess rules do not heal with it: an answer that cannot legally
  // be guessed is an unwinnable blind, which is worse than an easy one.
  for (const letter of ALPHABET) {
    const entry = state.letters[letter]
    if (entry) entry.destroyed = false
  }
  if (!restricted) return words.answers
  const healed = words.answers.filter((word) => validateGuess(word, state) === null)
  return healed.length > 0 ? healed : words.answers
}

function beginBlind(state: RunState, words: WordSource, events: GameEvent[]): void {
  const bossId = state.blindIndex === 2 ? bossForAnte(state) : null

  // Blind-start hooks run before the answer is drawn, so a joker that shrinks
  // the alphabet actually shrinks the search space too.
  const rng = derive(state.seed, "blind_start", state.ante, state.blindIndex)
  for (const [joker, ctx] of jokerHooks(state, rng, events)) joker.onBlindStart?.(ctx)

  const boss = getBoss(bossId)

  // The empty blind is installed before the answer is drawn, so guess rules that
  // read the round's history — The Tyrant reads its greens, and so does
  // ascension 5 — judge candidate answers against this round rather than the one
  // just finished.
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
    answerPool(state, words),
  )
  state.blind.answer = answer
  state.blind.revealed = Array.from(answer, () => null)

  state.phase = "blind"
  state.reward = null
  state.shop = null
}

/**
 * Roll the shop and stand the player in it.
 *
 * Shared by the two ways in — banking a reward, and choosing to play on past the
 * win — so the endless path cannot drift from the ordinary one. The hooks run
 * before the roll, so a joker that bends the shop bends the one it is about to
 * be shown rather than the next one.
 */
function enterShop(state: RunState, events: GameEvent[]): void {
  const rng = derive(state.seed, "shop_enter", state.ante, state.blindIndex)
  for (const [joker, ctx] of jokerHooks(state, rng, events)) joker.onShopEnter?.(ctx)

  state.shop = rollShop(state, derive(state.seed, "shop", state.ante, state.blindIndex, 0), 0)
  state.phase = "shop"
  events.push({ type: "shop_entered" })
}

/**
 * The fail state: score below target when the blind ends — and, at ascension 6,
 * a word left unsolved however big the pile is.
 */
function resolveBlind(state: RunState, events: GameEvent[]): void {
  const blind = state.blind

  // Before the win/lose branch, so a joker that grows on a blind ending counts
  // the blind that ended — including the one that ended the run. Losing makes
  // that moot rather than wrong, and the alternative is a hook whose firing
  // depends on an outcome it might itself be about to read.
  const rng = derive(state.seed, "blind_end", state.ante, state.blindIndex)
  for (const [joker, ctx] of jokerHooks(state, rng, events)) joker.onBlindEnd?.(ctx, blind)

  // Farming five wrong guesses to the target and never finding the word is a
  // real line in the ordinary game, and the whole of what ascension 6 takes
  // away. It is checked here rather than as a guess rule because it is not about
  // any one guess: it is about what the round had to have been.
  if (blind.score < blind.target || (!blind.solved && mustSolve(state))) {
    state.phase = "game_over"
    events.push({ type: "blind_lost" })
    return
  }

  // Paying for unused guesses is the counterweight to chip-farming: the economy
  // rewards exactly the restraint the scoring punishes.
  const base = BLIND_PAYOUT[state.blindIndex]
  const unusedGuesses = (blind.maxGuesses - blind.guesses.length) * GOLD_PER_UNUSED_GUESS
  // Jokers get to bend this the way they bend the solve multiplier, in slot
  // order and after the cap — so a card that zeroes it really zeroes it.
  let interest = Math.min(INTEREST_CAP, Math.floor(state.gold / INTEREST_PER))
  for (const instance of state.jokers) {
    const bend = JOKER_BY_ID.get(instance.id)?.interest
    if (bend) interest = bend(interest, state)
  }

  state.reward = { base, unusedGuesses, interest, total: base + unusedGuesses + interest }
  state.phase = "reward"
  events.push({ type: "blind_won" })
}

/**
 * Commit an item to the run. Returns a reason it could not be, or null when it
 * landed.
 *
 * Deliberately touches neither the gold nor the shelf it came off: what an item
 * *does* is the same whether it was paid for in the stock or chosen out of a
 * pack, and only the caller knows which of those happened.
 */
function applyItem(state: RunState, item: ShopItem): string | null {
  switch (item.kind) {
    case "joker": {
      if (state.jokers.length >= JOKER_SLOTS) return "no joker slots free"
      state.jokers.push({ id: item.id })
      return null
    }
    case "consumable": {
      if (state.consumables.length >= CONSUMABLE_SLOTS) return "no card slots free"
      state.consumables.push({ id: item.id })
      return null
    }
    case "etch": {
      const etching = ETCHING_BY_ID.get(item.id)
      if (!etching) return "unknown etching"
      // Burnt-out letters are skipped rather than etched: they cannot be typed
      // again, so the chips would be unspendable and the keyboard would wear a
      // "+2" pip on a dead key.
      for (const letter of etching.letters) {
        const entry = state.letters[letter]
        if (entry && !entry.destroyed) entry.etch += etching.chips
      }
      return null
    }
    case "level": {
      const category = CATEGORY_BY_ID.get(item.id)
      if (!category) return "unknown category"
      // Written on first purchase rather than initialised at run start, so a run
      // that never levels anything keeps `levels` out of its save.
      state.levels = { ...state.levels, [category.id]: levelOf(state, category.id) + 1 }
      return null
    }
    case "range": {
      const range = RANGE_BY_ID.get(item.id)
      if (!range) return "unknown range"
      // Stored on the run rather than pushed out into `letters`, unlike an
      // etching: a range level has to keep applying to a letter that is burnt
      // out and later restored, and writing it per letter would lose that. It
      // also means the save carries four numbers instead of 26.
      state.ranges = { ...state.ranges, [range.id]: rangeLevelOf(state, range.id) + 1 }
      return null
    }
    case "mod": {
      // An unattached one never reaches here: buying it opens the picker
      // instead, and packs only ever deal pairings. Refused rather than
      // asserted, because a save from a build where that stops being true would
      // otherwise put a modifier on the letter `undefined`.
      if (item.letter === undefined) return "that one needs a letter first"
      const entry = state.letters[item.letter]
      if (!entry) return "unknown letter"
      // A letter holds one modifier, so this replaces rather than stacks — the
      // card says so before the gold is spent.
      entry.mod = item.id
      return null
    }
    case "pack":
      // Packs open rather than apply, which the caller has to handle because it
      // needs a stream to roll the contents from. Reaching here means one was
      // nested inside another, which nothing produces.
      return "a pack cannot come out of a pack"
  }
}

/** What the event log calls an item, for the one line that announces a pick. */
function itemLabel(item: ShopItem): string {
  switch (item.kind) {
    case "joker":
      return JOKER_BY_ID.get(item.id)?.name ?? item.id
    case "consumable":
      return CONSUMABLE_BY_ID.get(item.id)?.name ?? item.id
    case "etch":
      return ETCHING_BY_ID.get(item.id)?.name ?? item.id
    case "level":
      return CATEGORY_BY_ID.get(item.id)?.name ?? item.id
    case "range":
      return RANGE_BY_ID.get(item.id)?.name ?? item.id
    case "mod": {
      const name = MODIFIER_BY_ID.get(item.id)?.name ?? item.id
      return item.letter ? `${name} ${item.letter.toUpperCase()}` : name
    }
    case "pack":
      return PACK_BY_ID.get(item.id)?.name ?? item.id
  }
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

/**
 * A new run, at the difficulty it was asked for.
 *
 * The ascension arrives as an argument rather than being read from anywhere: the
 * engine has no idea what the player has unlocked, and should not — which level
 * is on offer is a question about a profile, and profiles live where browsers do.
 */
export function startRun(seed: number, words: WordSource, ascension = 0): Reduced {
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
  // Left off the state entirely at zero, so the ordinary run's save is the same
  // file it was before ascensions existed.
  const level = clampAscension(ascension)
  if (level > 0) state.ascension = level
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
      return startRun(action.seed, words, action.ascension ?? 0)

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

      // Every rule in force, boss and ascension alike, in one stable order.
      const refusal = validateGuess(word, next)
      if (refusal) return reject(refusal)

      const boss = getBoss(blind.bossId)

      const tiles = toTiles(word, computeFeedback(word, blind.answer))
      // Before the transform, which is the whole point: the boss that wants to
      // say something about the feedback is the same boss about to destroy it.
      //
      // It is deliberately *not* re-asked after The Magician promotes a tile
      // below. The note is a fact about the guess — how many of these letters
      // are in the word — and stays true whether or not one of them was
      // afterwards handed back its colour. A player who reads "2 misplaced" and
      // can see one of them knows where the other is not, which is the counter
      // doing its job rather than a contradiction.
      const note = boss?.note?.(tiles) ?? null
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
        // Spread rather than assigned, so a guess under any other boss carries
        // no key at all — the same discipline `ascension` follows in a vector
        // and `data` follows on a joker.
        ...(note ? { note } : {}),
      })
      blind.score += result.score
      blind.draft = ""
      // The run's own record of what it has said. Kept whatever the ascension,
      // because the rule that reads it cannot be the thing that decides whether
      // it was written — a run that started recording halfway would enforce
      // "no word twice" against half a run.
      next.history = [...(next.history ?? []), word]

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
        if (!instance) continue
        instance.data = data
        // Growth earned while scoring gets the same announcement as growth
        // earned at a blind's end. Only slots that actually wrote turn up here,
        // so this never fires for a card that merely read its own counter, and
        // the label is whatever the card wears — floater and joker agree.
        const label = JOKER_BY_ID.get(instance.id)?.detail?.(instance)
        if (label) events.push({ type: "joker_grew", slot, id: instance.id, label })
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

      // The win is offered once, and `won` is what makes it once: past this the
      // run keeps passing ante `ANTES`'s last blind every three blinds, and a
      // victory screen every ante would turn the ending into a nag.
      if (!next.won && next.ante >= ANTES && next.blindIndex === 2) {
        next.won = true
        next.phase = "victory"
        events.push({ type: "run_won" })
        return { state: next, events }
      }

      enterShop(next, events)
      return { state: next, events }
    }

    case "continue_run": {
      if (next.phase !== "victory") return reject("the run is not won")
      // Picks up exactly where `collect` stopped. The win was offered *instead*
      // of the shop, so continuing is that shop, rolled now rather than then —
      // which is why a player who banks the win never fires a shop hook for a
      // shop they will not see.
      enterShop(next, events)
      return { state: next, events }
    }

    case "buy": {
      if (next.phase !== "shop" || !next.shop) return reject("not in the shop")
      if (next.pack) return reject("finish the open pack first")
      if (next.placing) return reject("place the modifier first")
      const item = next.shop.items[action.index]
      if (!item) return reject("already bought")
      if (next.gold < item.cost) return reject("not enough gold")

      // A pack is the one item that is not applied when it is bought. It opens,
      // and the gold buys the choice rather than any particular card in it —
      // which is why the contents are rolled here, at open time, and why the
      // reroll count is in the coordinate: rerolling the shelf to get a
      // different pack has to get different cards in it too.
      if (item.kind === "pack") {
        const pack = PACK_BY_ID.get(item.id)
        if (!pack) return reject("unknown pack")
        const options = packContents(
          next,
          pack,
          derive(next.seed, "pack", next.ante, next.blindIndex, next.shop.rerolls, action.index),
        )
        if (options.length === 0) return reject("nothing left to put in that pack")
        next.pack = { id: pack.id, options, picks: Math.min(pack.picks, options.length) }
        events.push({
          type: "pack_opened",
          id: pack.id,
          name: pack.name,
          options: options.length,
        })
      } else if (item.kind === "mod" && item.letter === undefined) {
        // The other item that is paid for before it is decided. Held rather than
        // applied, on the same terms as a pack: the gold buys the card, and where
        // it goes is the next question. Checked before the gold moves, because a
        // modifier with nowhere left to sit would otherwise take the money and
        // leave the player holding a card they cannot put down.
        const modifier = MODIFIER_BY_ID.get(item.id)
        if (!modifier) return reject("unknown modifier")
        if (placeableLetters(next, modifier).length === 0) {
          return reject("no letter left for that")
        }
        next.placing = modifier.id
      } else {
        const reason = applyItem(next, item)
        if (reason) return reject(reason)
      }

      next.gold -= item.cost
      next.shop.items[action.index] = null
      events.push({ type: "gold", delta: -item.cost, reason: "purchase" })
      return { state: next, events }
    }

    case "place_mod": {
      const held = next.placing
      if (!held) return reject("nothing to place")
      const modifier = MODIFIER_BY_ID.get(held)
      if (!modifier) return reject("unknown modifier")
      const letter = action.letter.toLowerCase()
      // The same question the shop asked before it stocked the card and before
      // it took the gold, asked once more against the alphabet as it is now.
      // Nothing can have changed it in between — the shop is held while a
      // modifier is in hand — but the picker is the only one of the three whose
      // input comes from outside.
      if (!placeableLetters(next, modifier).includes(letter)) {
        return reject(`${modifier.name} cannot go on ${letter.toUpperCase()}`)
      }
      const entry = next.letters[letter]
      if (!entry) return reject("unknown letter")
      // Replaces whatever was there, exactly as buying a pairing does. The
      // picker says which letters are already carrying something, so a trade is
      // a trade the player could see coming.
      entry.mod = modifier.id
      next.placing = null
      events.push({
        type: "mod_placed",
        id: modifier.id,
        letter,
        label: `${modifier.name} ${letter.toUpperCase()}`,
      })
      return { state: next, events }
    }

    case "pick_pack": {
      if (!next.pack) return reject("no pack is open")
      const item = next.pack.options[action.index]
      if (!item) return reject("already taken")
      // Nothing is charged — the pack was. A pick can still be refused, though,
      // by whatever the item itself needs: a joker with no slot free is the
      // ordinary case, and the pack stays open so the choice can go elsewhere.
      const reason = applyItem(next, item)
      if (reason) return reject(reason)

      next.pack.options[action.index] = null
      next.pack.picks -= 1
      events.push({ type: "pack_picked", id: next.pack.id, label: itemLabel(item) })
      if (next.pack.picks <= 0) next.pack = null
      return { state: next, events }
    }

    case "skip_pack": {
      if (!next.pack) return reject("no pack is open")
      events.push({ type: "pack_picked", id: next.pack.id, label: null })
      next.pack = null
      return { state: next, events }
    }

    case "sell_joker": {
      if (next.phase !== "shop") return reject("you can only sell in the shop")
      if (next.pack) return reject("finish the open pack first")
      if (next.placing) return reject("place the modifier first")
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
      if (next.pack) return reject("finish the open pack first")
      if (next.placing) return reject("place the modifier first")
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
      if (next.pack) return reject("finish the open pack first")
      if (next.placing) return reject("place the modifier first")
      if (next.blindIndex === 2) {
        next.ante += 1
        next.blindIndex = 0
      } else {
        next.blindIndex = (next.blindIndex + 1) as BlindIndex
      }

      // No ceiling here any more. Passing ante `ANTES` used to be the end of the
      // run and is now the end of the *authored* run: `blindTargets` is
      // geometric past the last hand-set ante and `bossForAnte` wraps within its
      // band, so ante 9 and ante 90 are both ordinary antes as far as this is
      // concerned. The win was already offered when the reward for the final
      // ante's last blind was banked, which is the only place it belongs — this
      // gate could only ever have fired for a run that skipped that one.
      beginBlind(next, words, events)
      return { state: next, events }
    }
  }
}
