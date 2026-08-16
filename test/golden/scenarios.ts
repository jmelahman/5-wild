/**
 * The players whose runs get recorded as golden vectors.
 *
 * These only ever run while recording. The committed vectors hold the concrete
 * actions each one produced, and the test replays *those* — so a scenario can
 * be rewritten, or deleted, without invalidating a vector it authored. What is
 * under test is the engine, not the bot.
 *
 * Each scenario must be a pure function of the state it is handed. A bot that
 * consulted a clock or a random number would record an action list the engine
 * could never reproduce.
 */

import type { Action, ModId, RunState, WordSource } from "../../src/engine"
import {
  AUTHORED_ASCENSIONS,
  baseChips,
  categoryOf,
  levelBonus,
  MODIFIER_BY_ID,
  placeableLetters,
  reduce,
  rerollCost,
  solveBonusFor,
} from "../../src/engine"

export type Scenario = {
  name: string
  /** What this run is meant to pin down, for whoever reads a failure. */
  covers: string
  seed: number
  /** The difficulty to start at. Absent is the ordinary game, as it is in a run. */
  ascension?: number
  /** The next batch of actions, or null to stop. */
  next: (state: RunState, words: WordSource) => Action[] | null
}

const typeWord = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** Every action the engine accepted, dry-run — nothing here mutates the run. */
function accepted(state: RunState, words: WordSource, actions: Action[]): boolean {
  let current = state
  for (const action of actions) {
    const result = reduce(current, action, words)
    if (result.events.some((event) => event.type === "rejected")) return false
    current = result.state
  }
  return true
}

/**
 * The first candidate the engine will actually take. Boss rules refuse whole
 * classes of word — two vowels, no repeats — and a destroyed letter cannot be
 * typed at all, so a bot that assumes its guess lands would stall the recorder
 * on a round it can never submit to.
 */
function firstPlayable(
  state: RunState,
  words: WordSource,
  candidates: readonly string[],
): Action[] | null {
  for (const word of candidates) {
    const actions = typeWord(word)
    if (accepted(state, words, actions)) return actions
  }
  return null
}

/**
 * A change of mind before the real word. Backspace is the one action nothing
 * else here would ever produce, and typing the answer's own first letter is
 * always legal — answers are drawn to avoid burnt-out letters, so the draft is
 * guaranteed to accept it and the erase leaves the guess exactly as it was.
 */
function withCorrection(state: RunState, guess: Action[] | null): Action[] | null {
  const letter = state.round.answer[0]
  if (!guess || !letter) return guess
  return [{ type: "type_letter", letter }, { type: "backspace" }, ...guess]
}

/** Words that are not the answer, walked from a seed-independent offset. */
function decoys(state: RunState, words: WordSource, offset: number): string[] {
  const list = words.answers
  const out: string[] = []
  for (let i = 0; i < 40; i++) {
    const word = list[(offset + i * 97) % list.length]
    if (word && word !== state.round.answer) out.push(word)
  }
  return out
}

/** How many tiles of a word would carry a modifier — copies counted separately. */
function modTiles(state: RunState, word: string): number {
  return [...word].filter((letter) => state.letters[letter]?.mod).length
}

/**
 * English letter frequency, roughly. What a player aiming a modifier is actually
 * reaching for — the letter they will type most — and a fixed order, which is
 * what a recorded vector needs.
 */
const BY_USE = "etaoinsrhldcumfpgwybvkxjqz"

/**
 * The two rare modifiers, and what it costs to be able to buy one. The price is
 * the dearer of the pair rather than either in particular: a bot that stopped
 * rerolling with exactly Steel money in hand would walk away from a Glass.
 */
const RARE_MODS: readonly ModId[] = ["steel", "glass"]
const RARE_PRICE = Math.max(...RARE_MODS.map((id) => MODIFIER_BY_ID.get(id)?.choiceCost ?? 0))

/** What it costs to walk out of a shop holding an Anchor. */
const ANCHOR_PRICE = MODIFIER_BY_ID.get("anchor")?.choiceCost ?? 0

/**
 * How many of a word's tiles would land green *on a letter carrying `mod`*.
 *
 * `modTiles` counts a card's tiles whatever colour they come up, which is the
 * right question for a card that pays on every tile and the wrong one for a card
 * that pays on one colour. Anchor is the second kind, so a bot aiming it has to
 * be able to tell a tile that will fire from a tile that merely carries.
 */
function greenMods(state: RunState, word: string, mod: ModId): number {
  const answer = state.round.answer
  return [...word].filter(
    (letter, index) => letter === answer[index] && state.letters[letter]?.mod === mod,
  ).length
}

/**
 * Put the modifier in hand on the most-typed letter still open to it.
 *
 * Lives outside any one scenario because it is not really a strategy: the shop
 * refuses every other action until a bought modifier has been placed, so any bot
 * that buys one has to answer this before it can do anything else, and they
 * would all answer it the same way. The recorder applies it for all of them.
 */
export function placeMod(state: RunState): Action[] | null {
  const modifier = state.placing ? MODIFIER_BY_ID.get(state.placing) : undefined
  if (!modifier) return null
  const open = new Set(placeableLetters(state, modifier))
  const letter = [...BY_USE].find((candidate) => open.has(candidate))
  return letter ? [{ type: "place_mod", letter }] : null
}

/** What a word's category level is currently worth to it, chips and mult together. */
function levelValue(state: RunState, word: string): number {
  const bonus = levelBonus(state, categoryOf(word))
  return bonus.chips + bonus.mult
}

/** What a word's letters are worth right now, both letter upgrade lines included. */
function wordChips(state: RunState, word: string): number {
  return [...word].reduce((total, letter) => total + baseChips(state, letter), 0)
}

/** Bank the reward, then leave the shop without spending. */
function passThrough(state: RunState): Action[] | null {
  if (state.phase === "reward") return [{ type: "collect" }]
  if (state.phase === "shop") return [{ type: "next_round" }]
  return null
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "greedy-solver",
    covers: "the solve bonus at its largest, and a shop purchase every time one is affordable",
    seed: 1,
    next: (state, words) => {
      if (state.phase === "round") return firstPlayable(state, words, [state.round.answer])
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const index = state.shop?.items.findIndex((item) => item && item.cost <= state.gold) ?? -1
        if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
          return [{ type: "buy", index }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  {
    name: "chip-farmer",
    covers:
      "grays scoring, the guess budget spent down to one, and the solve bonus at its smallest",
    seed: 7,
    next: (state, words) => {
      if (state.phase === "round") {
        const spent = state.round.guesses.length
        // Burn every guess but the last on decoys, then solve. This is the
        // income line: more tiles scored, a far smaller solve multiplier.
        const candidates =
          spent >= state.round.maxGuesses - 1
            ? [state.round.answer]
            : [...decoys(state, words, spent * 13), state.round.answer]
        return firstPlayable(state, words, candidates)
      }
      return passThrough(state)
    },
  },
  {
    name: "banker",
    covers: "a pile banked and then multiplied — the line the scoring rule exists for",
    seed: 2024,
    next: (state, words) => {
      if (state.phase === "round") {
        // Farm two guesses, then cash in while the multiplier is still large.
        // Solving instantly multiplies nothing and solving on the last guess
        // multiplies by one, so without this scenario the vectors would record
        // the same totals whether the bonus applied to the round or the guess.
        const spent = state.round.guesses.length
        const candidates =
          spent < 2
            ? [...decoys(state, words, spent * 29), state.round.answer]
            : [state.round.answer]
        return firstPlayable(state, words, candidates)
      }
      return passThrough(state)
    },
  },
  {
    name: "never-solves",
    covers: "running a round out of guesses, and the run ending in defeat",
    seed: 42,
    next: (state, words) => {
      if (state.phase === "round") return firstPlayable(state, words, decoys(state, words, 5))
      return passThrough(state)
    },
  },
  {
    name: "shopkeeper",
    covers: "reroll, sell, consumables used rather than hoarded, and a corrected draft",
    seed: 1234,
    next: (state, words) => {
      if (state.phase === "round") {
        // Spend a consumable the moment there is one: the Oracle and the
        // Hermit change what a later guess scores, which is exactly the kind of
        // cross-turn effect a per-guess score list is there to pin down.
        if (state.round.guesses.length === 0 && state.consumables.length > 0) {
          if (accepted(state, words, [{ type: "use_consumable", index: 0 }])) {
            return [{ type: "use_consumable", index: 0 }]
          }
        }
        return withCorrection(state, firstPlayable(state, words, [state.round.answer]))
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        if (state.shop?.rerolls === 0 && accepted(state, words, [{ type: "reroll" }])) {
          return [{ type: "reroll" }]
        }
        const index = state.shop?.items.findIndex((item) => item && item.cost <= state.gold) ?? -1
        if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
          return [{ type: "buy", index }]
        }
        // Selling back is the only way the relic slots ever empty, and it is
        // priced — a vector that never sells cannot catch that price moving.
        if (
          state.relics.length >= 2 &&
          accepted(state, words, [{ type: "sell_relic", index: 0 }])
        ) {
          return [{ type: "sell_relic", index: 0 }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  /*
   * The consumables, actually spent.
   *
   * `shopkeeper` uses index 0 before its first guess of a round, which reaches
   * exactly one of the four: The Magician. The other three were bought, carried
   * and thrown away unused across every vector in the file — and The Fool is the
   * reason why, because it rescores the previous guess and there is no previous
   * guess before the first one. A bot that only ever spends at the top of a
   * round cannot use it at all, so the card's whole arithmetic went unrecorded.
   *
   * This one spends whatever the engine will take, whenever it will take it,
   * which is what turns the order into coverage rather than a rule: Oracle and
   * Hermit are accepted before a guess and go first, and The Fool becomes legal
   * only once there is something behind it. The probe is there for the same
   * reason — the Fool doubling a real score is the case worth pinning, and a
   * bot that solved on sight would have handed it a solve to copy instead.
   *
   * Spending all four is not the hard part once the order is right — 160 of the
   * first 400 seeds manage it, and only four spend nothing. Seed 126 is simply
   * the shortest of the 160, which is the whole basis for the choice: at this
   * hit rate the seed is not buying an outcome, it is buying fewer lines of
   * JSON for the same coverage.
   */
  {
    name: "mystic",
    covers: "consumables spent rather than hoarded, including the one that needs a guess behind it",
    seed: 126,
    next: (state, words) => {
      if (state.phase === "round") {
        // Whichever card the engine will take right now, in slot order. Trying
        // them rather than knowing them is the point: the legality is the rule
        // under test, and a bot that hardcoded which card works when would stop
        // noticing when that changed.
        const index = state.consumables.findIndex((_, slot) =>
          accepted(state, words, [{ type: "use_consumable", index: slot }]),
        )
        if (index >= 0) return [{ type: "use_consumable", index }]

        const spent = state.round.guesses.length
        const candidates =
          spent === 0 ? [...decoys(state, words, 19), state.round.answer] : [state.round.answer]
        return firstPlayable(state, words, candidates)
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        // Cards first, then relics to stay alive long enough to draw more of
        // them. Consumables are the one item that can be bought while already
        // holding one, so the slot cap does the throttling here, not the bot.
        for (const kind of ["consumable", "relic"] as const) {
          const index = items.findIndex((item) => item?.kind === kind && item.cost <= state.gold)
          if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
            return [{ type: "buy", index }]
          }
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  {
    name: "letter-smith",
    covers: "letter modifiers bought, and then landed on tiles often enough to score",
    seed: 9,
    next: (state, words) => {
      if (state.phase === "round") {
        // One probe chosen for the modifiers it would fire, then the answer. A
        // modifier that is only ever bought is a shop test; what these vectors
        // are for is the mult it multiplies and the gold it pays.
        const probes =
          state.round.guesses.length === 0
            ? [...decoys(state, words, 7)].sort((a, b) => modTiles(state, b) - modTiles(state, a))
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        const wanted = items.findIndex((item) => item?.kind === "mod" && item.cost <= state.gold)
        if (wanted >= 0 && accepted(state, words, [{ type: "buy", index: wanted }])) {
          return [{ type: "buy", index: wanted }]
        }
        // Hunt for one while there is gold to spare. The cost climbs with every
        // reroll, so this drains rather than loops.
        if (state.gold >= 10 && accepted(state, words, [{ type: "reroll" }])) {
          return [{ type: "reroll" }]
        }
        const index = items.findIndex((item) => item && item.cost <= state.gold)
        if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
          return [{ type: "buy", index }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  /*
   * Anchor, and the colour it is fussy about.
   *
   * This one is here because of how it went missing. `letter-smith` held an
   * Anchor for as long as the modifier table had eleven entries; the reweighting
   * to sixteen dropped the card to one roll in sixteen behind a slot that is
   * three in four, and it fell out of every recorded run at once. Nothing failed
   * — no test went red, the vectors re-recorded cleanly, and the diff read as a
   * shop change, which it was. The card's own arithmetic simply stopped being
   * exercised, and it stopped on the same pass that resized it. A card is worth
   * a scenario when the shelf can take it away from you quietly.
   *
   * What that scenario has to do is not obvious, because solving hides the bug.
   * The winning guess is five greens by definition, so a solve-on-sight bot
   * fires every Anchor the answer contains and records a fat number every time —
   * and would go on recording it if the card paid on any colour at all. The gate
   * is the half worth pinning, so the probe is filtered rather than sorted: a
   * candidate is played only if it puts an anchored letter in its own position,
   * and the guess is skipped when none would. Sorting by `modTiles` the way the
   * rare hunt does was the first attempt and it is the wrong question — it ranks
   * tiles that carry the card above tiles that fire it, which for a colour-gated
   * card are different sets.
   *
   * Over the first 600 seeds, 194 end holding at least one, 143 fire one off a
   * guess that did not solve, and 47 do both with two or more on the board. Seed
   * 32 is the best of the 47 by a distance: five Anchors placed, fifteen greens
   * fired outside a solve across 28 guesses, and it lives to stage 5.2. Five
   * copies is what makes it useful rather than merely green — the card is a flat
   * +125 per firing tile, so a run carrying five of them is where an error in
   * that number is loudest instead of roundable.
   */
  {
    name: "anchor-smith",
    covers: "Anchor stacked across letters, fired on greens no solve handed it",
    seed: 32,
    next: (state, words) => {
      if (state.phase === "round") {
        // The probe is chosen to land the card green rather than merely to carry
        // it, and is skipped entirely when no candidate would. Anchor pays on one
        // colour, so a guess that puts it on a gray costs a gold and records
        // nothing the solve was not going to record anyway.
        const armed = Object.values(state.letters).some((letter) => letter.mod === "anchor")
        const probes =
          armed && state.round.guesses.length === 0
            ? decoys(state, words, 29)
                .filter((word) => greenMods(state, word, "anchor") > 0)
                .sort((a, b) => greenMods(state, b, "anchor") - greenMods(state, a, "anchor"))
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        const anchor = items.findIndex(
          (item) => item?.kind === "mod" && item.id === "anchor" && item.cost <= state.gold,
        )
        if (anchor >= 0 && accepted(state, words, [{ type: "buy", index: anchor }])) {
          return [{ type: "buy", index: anchor }]
        }
        // Same stopping rule as the rare hunt, for the same reason: reroll only
        // while the change still covers the card being hunted.
        const reroll = rerollCost(state.shop ?? { items: [], rerolls: 0 })
        if (state.gold >= reroll + ANCHOR_PRICE && accepted(state, words, [{ type: "reroll" }])) {
          return [{ type: "reroll" }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  /*
   * The rare modifier pair, which nothing else here ever holds.
   *
   * `letter-smith` buys the first modifier it can afford, and the first
   * affordable modifier is a common one. Steel and Glass are one entry each in
   * a sixteen-entry table behind a slot that is itself three rolls in four, so
   * a given visit offers a particular one about 5% of the time. Across every
   * other vector that came to zero: the two dearest cards in the letter line,
   * the two whose numbers get argued over most, and no recorded run had ever
   * put one on a letter.
   *
   * So this bot solves on sight — the fastest income line there is, five unused
   * guesses and the round's base — and then spends the whole pile hunting. It
   * works: 302 of the first 600 seeds end holding one, and 65 hold both at some
   * point in the run. Only 9 of the 600 *end* holding both, which is not the
   * hunt failing but the Glass doing what it says — it shatters on a gray, so
   * counting the final board undercounts every run that played one and lost it.
   * The measurement that matters here is what the letters carried while the
   * guesses were being scored.
   *
   * Seed 490 is one of the nine that keeps both to the end, and is picked over
   * the other eight for holding three rare cards at once — Steel on a and t,
   * Glass on e — so the vector records the two of them scoring side by side
   * rather than in different runs. It replaced 397, which was chosen against the
   * eleven-entry table and degraded to a single Steel and a stage-two death when
   * the shelf was reweighted. That is the failure mode to expect from any seed
   * picked for what it happens to draw: it is not wrong afterwards, just weaker,
   * and the vector goes on passing while covering less than its comment claims.
   *
   * These numbers moved once already. At the eleven-entry table it was 7% a
   * visit and 386 of 600, and the reweighting that made the strong cards 3 in 16
   * is what took it to 5% and 302 — so treat them as a reading of the current
   * shelf rather than a fact about the bot.
   *
   * It dies shallow, and that is the trade being made on purpose. Depth is what
   * every other vector already has; what this one is for is the pair that only
   * turns up if you go looking and can still pay the reroll when it does.
   */
  {
    name: "rare-smith",
    covers: "the rare modifier pair, hunted down with rerolls and played through",
    seed: 490,
    next: (state, words) => {
      if (state.phase === "round") {
        // Solve on sight until there is a card to fire, then spend one guess a
        // round on the word that fires it most. Before the first purchase every
        // guess left unspent is a gold towards the hunt; after it, a modifier
        // nobody ever plays through is a shop test rather than a scoring one,
        // and the second is what this vector is for. The trade is one gold a
        // round, which is what an unused guess pays.
        const armed = Object.values(state.letters).some((letter) => letter.mod)
        const probes =
          armed && state.round.guesses.length === 0
            ? [...decoys(state, words, 23)].sort((a, b) => modTiles(state, b) - modTiles(state, a))
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        const rare = items.findIndex(
          (item) => item?.kind === "mod" && RARE_MODS.includes(item.id) && item.cost <= state.gold,
        )
        if (rare >= 0 && accepted(state, words, [{ type: "buy", index: rare }])) {
          return [{ type: "buy", index: rare }]
        }
        // Keep hunting only while the gold left over could still pay for what is
        // being hunted. Without the second term the bot rerolls itself broke and
        // walks past the card it was looking for on the visit it finally appears.
        const reroll = rerollCost(state.shop ?? { items: [], rerolls: 0 })
        if (state.gold >= reroll + RARE_PRICE && accepted(state, words, [{ type: "reroll" }])) {
          return [{ type: "reroll" }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  {
    name: "leveller",
    covers: "category levels bought, stacked, and paid out on the guesses that match them",
    seed: 77,
    next: (state, words) => {
      if (state.phase === "round") {
        // One probe chosen for the level bonus it would collect, then the
        // answer. The sort is what makes this vector worth recording: it pins
        // that levels land on the base *and* that `categoryOf` picked the same
        // shape the shop charged for, because a mismatch would show up as a
        // probe that scored like an unlevelled word.
        const probes =
          state.round.guesses.length === 0
            ? [...decoys(state, words, 3)].sort(
                (a, b) => levelValue(state, b) - levelValue(state, a),
              )
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        // Levels before anything else, whichever category the slot dealt. It
        // cannot choose — the shop picks the category — so this ends the run
        // holding several at level two rather than one high, which is a fair
        // picture of what buying every level you are offered actually gets you.
        const wanted = items.findIndex((item) => item?.kind === "level" && item.cost <= state.gold)
        if (wanted >= 0 && accepted(state, words, [{ type: "buy", index: wanted }])) {
          return [{ type: "buy", index: wanted }]
        }
        // Relics otherwise, so the run has ×mult for the levels to pass through.
        const relic = items.findIndex((item) => item?.kind === "relic" && item.cost <= state.gold)
        if (relic >= 0 && accepted(state, words, [{ type: "buy", index: relic }])) {
          return [{ type: "buy", index: relic }]
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  {
    name: "etcher",
    covers: "alphabet range levels and etchings stacking on the same letters",
    seed: 21,
    next: (state, words) => {
      if (state.phase === "round") {
        // One probe picked for what its letters are worth right now, then the
        // answer. The sort is what makes this vector worth recording: it reads
        // `baseChips`, so if a range level ever stopped reaching a letter — or
        // stopped adding to the etching already on it — the probe would score
        // like an un-upgraded word and every number after it would move.
        const probes =
          state.round.guesses.length === 0
            ? [...decoys(state, words, 5)].sort((a, b) => wordChips(state, b) - wordChips(state, a))
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        const items = state.shop?.items ?? []
        // Two relics first, then both letter lines, ranges ahead of etchings.
        // The relic floor is not a flourish: chips are only ever half of a
        // score, and a bot that spent its whole run raising them stalled in stage
        // two with nothing to multiply them by. Once it has some mult, buying in
        // this order is what gets the two lines stacked on one letter — the
        // ranges partition the alphabet, so whichever etching lands afterwards
        // is guaranteed to overlap one that has already been levelled.
        const order =
          state.relics.length < 2
            ? (["relic", "range", "etch"] as const)
            : (["range", "etch", "relic"] as const)
        for (const kind of order) {
          const index = items.findIndex((item) => item?.kind === kind && item.cost <= state.gold)
          if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
            return [{ type: "buy", index }]
          }
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  {
    name: "pack-opener",
    covers: "packs bought, held open across the shop, and chosen from",
    seed: 5,
    next: (state, words) => {
      if (state.phase === "round") {
        // One probe, then the answer. Packs deal all three card lines, so the
        // sort keys off modifiers first and levels second rather than off any
        // single one — whichever the packs happened to hand this run, the probe
        // is the word that collects the most of it.
        const probes =
          state.round.guesses.length === 0
            ? [...decoys(state, words, 11)].sort(
                (a, b) =>
                  modTiles(state, b) - modTiles(state, a) ||
                  levelValue(state, b) - levelValue(state, a),
              )
            : []
        return firstPlayable(state, words, [...probes, state.round.answer])
      }
      if (state.phase === "reward") return [{ type: "collect" }]
      if (state.phase === "shop") {
        // An open pack holds the shop, so it has to be resolved before anything
        // else is even legal. Taking the first card the engine accepts is the
        // whole point of recording this bot: a pack applies its card for free,
        // and a vector that only ever *bought* one could not tell whether the
        // card that came out of it ever landed.
        if (state.pack) {
          // Stage one is walked away from on purpose, for the same reason the
          // shopkeeper's backspace is there: the shelf no longer sells a pack
          // that cannot be opened, so nothing these bots do would otherwise
          // ever produce a skip — and a forfeit that quietly handed the gold
          // back would then be outside the contract entirely.
          if (state.stage === 1) return [{ type: "skip_pack" }]
          const index = state.pack.options.findIndex(
            (item, slot) => item && accepted(state, words, [{ type: "pick_pack", index: slot }]),
          )
          return index >= 0 ? [{ type: "pick_pack", index }] : [{ type: "skip_pack" }]
        }
        const items = state.shop?.items ?? []
        // Two relics before the packs, for the same reason the etcher wants
        // them: packs deal cards that add to a score, and a run with nothing to
        // multiply by stalls in stage two no matter how good the cards were.
        const order =
          state.relics.length < 2 ? (["relic", "pack"] as const) : (["pack", "relic"] as const)
        for (const kind of order) {
          const index = items.findIndex((item) => item?.kind === kind && item.cost <= state.gold)
          if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
            return [{ type: "buy", index }]
          }
        }
        return [{ type: "next_round" }]
      }
      return null
    },
  },
  /*
   * The run that wins, and the only one. Every other vector here ends in
   * `game_over`, which left the whole back half of the ending — the `victory`
   * phase, `continue_run`, and the stages past `STAGES` that have no authored
   * target — asserted by nothing at all. A rewrite could have dropped the win
   * condition on the floor and this file would have agreed with it.
   *
   * Nothing here records `outcome: "victory"` even so, because this bot walks
   * through the win rather than stopping on it. What pins the win instead is the
   * refusal test: `continue_run` is refused unless the phase is `victory`, so an
   * engine that stopped awarding the win would refuse the action, and the
   * assertion that no recorded action is ever refused would name it.
   *
   * Picking a seed to get an outcome is normally how a vector stops being about
   * the rules and starts being about the bot, so the choice is defended rather
   * than asserted. Winning is genuinely rare — the climber's line takes 156 of
   * the first 12,000 seeds — and the spread is not a curve but two piles: 238
   * runs of 300 dead in stage one, against a tail that reaches stage eight
   * almost intact. No bot wins on an arbitrary seed, so a seed had to be
   * chosen. What 5517 was chosen *for*:
   *
   *   - Six of those 156 meet, in one run, every boss the other ten vectors miss
   *     between them. This is one of the six.
   *   - Of the six it is the only one that also wins under all five shop
   *     policies measured — relic-first, relic-then-level, level-first,
   *     relics-then-upgrades, packs-and-relics. It is a seed where the run is
   *     winnable, not a seed tuned to this bot's quirks.
   *   - It goes the deepest of them, dying on stage 11's boss round.
   *
   * That last point is why one run can close the boss gap at all, and the reason
   * is structural rather than lucky. The late band is drawn without replacement
   * and indexed from stage 7, so a run reaching stage 11's boss has met all five
   * of them in order. Those bosses were uncovered *because* nothing survived
   * past stage 7 — no shallow vector could have reached them, and no number of
   * shallow vectors would have helped.
   */
  {
    name: "victor",
    covers:
      "the run won and then played past, the computed targets beyond stage 8, and the whole " +
      "late boss band nothing else survives to meet",
    seed: 5517,
    next: climb,
  },
  {
    name: "ascendant",
    covers:
      "the whole written ascension ladder: guesses filtered by the run's rules, targets and " +
      "payouts bent by them, every round solved",
    seed: 13,
    ascension: AUTHORED_ASCENSIONS,
    next: climb,
  },
  /*
   * The half of the ladder that has no rules left to add. Its targets are the
   * only thing this pins that the rung below does not — the endless step is a
   * pure multiplication, and a port that compounded it wrongly, or rounded it
   * to the hundred `roundTargets` rounds to, would clear a different first
   * round and diverge on the very first score.
   *
   * It records a short run and that is the honest outcome, not a shortfall: at
   * ×1.56 targets with a thinned shelf and a round that has to be solved, the
   * climber's line does not last, and a vector that pretended otherwise would be
   * a vector of a bot rather than of the rules. Across 40 seeds it clears 0 to 14
   * rounds, mean 2.75, so a run of about four is this scenario at its typical.
   *
   * Seed 20 rather than 21, and the reason is worth stating because reseeding a
   * vector is normally the wrong repair. Replacing rung 9 handed this level back
   * its sixth guess, which changed nothing about what the scenario covers and
   * everything about where its decoy walk lands — seed 21 diverged onto a line
   * that dies on the first round, taking the run from four rewards and three
   * relics to one and one. Nothing was pinned any better for it. The seed moved
   * to hold the coverage the scenario was written to have, not to hold a number.
   */
  {
    name: "endless",
    covers: "a rung above the written ladder: targets compounded by the endless step",
    seed: 20,
    ascension: AUTHORED_ASCENSIONS + 4,
    next: climb,
  },
]

/**
 * The climber's line, shared by both ascension vectors.
 *
 * Named rather than inlined because the two differ only in where on the ladder
 * they stand: the same play against the written rules and against the endless
 * ones is what makes the pair of vectors a comparison rather than two runs.
 */
function climb(state: RunState, words: WordSource): Action[] | null {
  // Take the win and keep going. Only `victor` ever gets here — the two
  // ascension runs die well short — but it belongs to the line rather than to
  // one scenario: a climber is the bot that would carry on, and this is the
  // only place `continue_run` is reachable at all.
  if (state.phase === "victory") return [{ type: "continue_run" }]
  if (state.phase === "round") {
    const round = state.round
    const left = round.maxGuesses - round.guesses.length - 1
    // Cash in the moment solving would clear the target, and on the last
    // guess whatever the pile is worth: at the top of the ladder a round
    // that is never solved is a round that is lost, target met or not.
    //
    // The probes are where the rules bite. `firstPlayable` walks past every
    // decoy the engine refuses, so what lands in this vector is the first
    // word the ladder actually allowed — a port that filtered guesses
    // differently would record a different word and every score after it.
    const cashOut = left <= 0 || round.score * solveBonusFor(state, left) >= round.target
    const candidates = cashOut
      ? [round.answer]
      : [...decoys(state, words, round.guesses.length * 17), round.answer]
    return firstPlayable(state, words, candidates)
  }
  if (state.phase === "reward") return [{ type: "collect" }]
  if (state.phase === "shop") {
    // A pack holds the shop until it is resolved, so it comes first however
    // it was bought.
    if (state.pack) {
      const picked = state.pack.options.findIndex(
        (item, slot) => item && accepted(state, words, [{ type: "pick_pack", index: slot }]),
      )
      return picked >= 0 ? [{ type: "pick_pack", index: picked }] : [{ type: "skip_pack" }]
    }
    const items = state.shop?.items ?? []
    // Relics before anything else, then whatever is affordable. A bot that
    // spent nothing would die in stage one and this vector would cover three
    // rounds of a ladder meant to be climbed for eight stages.
    for (const kind of ["relic", null] as const) {
      const index = items.findIndex(
        (item) => item && (kind === null || item.kind === kind) && item.cost <= state.gold,
      )
      if (index >= 0 && accepted(state, words, [{ type: "buy", index }])) {
        return [{ type: "buy", index }]
      }
    }
    return [{ type: "next_round" }]
  }
  return null
}
