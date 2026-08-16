import type { BossTier, Rarity, RunState, ShopItem } from "../engine"
import {
  ASCENSIONS,
  AUTHORED_ASCENSIONS,
  ascensionAt,
  BOSS_TIERS,
  BOSSES,
  baseChips,
  bossesIn,
  CATEGORIES,
  CATEGORY_BY_ID,
  CHIPS_PER_LEVEL,
  CONSUMABLE_BY_ID,
  CONSUMABLE_SLOTS,
  CONSUMABLES,
  categoryOf,
  difficultyOf,
  draftChips,
  ETCHING_BY_ID,
  ETCHINGS,
  GOLD_PER_UNUSED_GUESS,
  getBoss,
  INTEREST_CAP,
  INTEREST_PER,
  keyboardColors,
  LETTER_CHIPS,
  levelBonus,
  levelOf,
  MAX_ASCENSION,
  MODIFIER_BY_ID,
  MODIFIERS,
  modifierOf,
  PACK_BY_ID,
  PACKS,
  placeableLetters,
  RANGE_BY_ID,
  RANGES,
  RELIC_BY_ID,
  RELIC_SLOTS,
  RELICS,
  ROUND_NAMES,
  ROUND_PAYOUT,
  ROUNDS_PER_STAGE,
  rangeChips,
  rangeLevelOf,
  rangeOf,
  rerollCost,
  rulesFor,
  STAGES,
  sellValue,
  solveBonusFor,
  TIER_STAGES,
} from "../engine"
import type { CoachStep } from "./coach"
import { h } from "./dom"
import { money, formatNumber as num } from "./format"
import type { MetaState } from "./meta"
import {
  chosenAscension,
  favouriteRelics,
  favouriteWord,
  isLocked,
  meanSolve,
  roundsPlayed,
  unlocked,
  wordsFound,
} from "./meta"

export type Handlers = {
  key: (letter: string) => void
  enter: () => void
  back: () => void
  useConsumable: (index: number) => void
  collect: () => void
  buy: (index: number) => void
  sell: (index: number) => void
  reroll: () => void
  nextRound: () => void
  continueRun: () => void
  pickPack: (index: number) => void
  skipPack: () => void
  /** Where the modifier just bought is going. */
  placeMod: (letter: string) => void
  newRun: () => void
  /** The difficulty the *next* run starts at. Nothing in flight can hear this. */
  setAscension: (level: number) => void
  inspect: (text: string) => void
  play: () => void
  mute: () => void
  toggleMusic: () => void
  /** Hide the per-letter numbers and marks, for a player who wants to deduce. */
  togglePlain: () => void
  openMenu: () => void
  openHelp: () => void
  /** Retire the first-round coaching, now and for good. */
  skipCoach: () => void
  openCodex: () => void
  /** The shape panel, from the board or from the shop. */
  openShapes: () => void
  /** The long record, from the title screen's one-line version of it. */
  openStats: () => void
  closeOverlay: () => void
  askQuit: () => void
  quit: () => void
  /** The lock on the ladder, opened far enough to read what is behind it. */
  askAscend: (level: number) => void
  /** Past the lock, having read it. */
  ascend: () => void
}

/**
 * Presentation state the engine has no opinion about.
 *
 * `coach` is the odd one out — it is derived from the run rather than from a
 * setting — and it rides here anyway, because the question it answers is a
 * presentation one: whether this player has been shown the first round yet. The
 * engine cannot know that, the view must not decide it, and putting it here is
 * what keeps `roundView`'s signature the same three arguments every other
 * screen takes.
 */
export type Chrome = {
  muted: boolean
  musicOff: boolean
  plain: boolean
  coach: CoachStep | null
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]

/* -------------------------------------------------------------- shared bits */

/**
 * The menu is the only route to sound, the rules and quitting once a run is
 * under way, so it has to be on every in-run screen rather than parked on a
 * screen the player passes through once.
 */
function menuButton(on: Handlers): HTMLElement {
  return h(
    "button",
    { class: "menu-button", type: "button", "aria-label": "Menu", onclick: () => on.openMenu() },
    "☰",
  )
}

/**
 * The letter-values switch, on the board rather than in the menu.
 *
 * It used to live in the pause sheet beside sound and music, and it was the one
 * setting there whose effect could not be seen from the screen it was set on:
 * pressing it turned the pips off behind a sheet covering them, and the player
 * had to close the sheet to find out what they had done. Here the board changes
 * under the thumb, which is the entire feedback the switch needs.
 *
 * It sits beside the chips × mult readout rather than up in the HUD, because
 * that is where the thing it governs is being totted up — the numbers on the
 * keys feed that line, and the switch belongs at the bottom of the screen with
 * them and within reach of the thumb already on the keyboard.
 *
 * The face is the setting rather than a label for it — a letter carrying its
 * value, or the same letter on its own — so a button two characters wide says
 * what it does without spending a word on it. The chip colour on the digit is
 * the same one the keys use, which is what makes the pair read as a before and
 * after rather than as an "A" and a "1".
 */
function plainToggle(on: Handlers, chrome: Chrome): HTMLElement {
  return h(
    "button",
    {
      class: `plain-toggle ${chrome.plain ? "off" : ""}`,
      type: "button",
      "aria-pressed": chrome.plain ? "false" : "true",
      "aria-label": chrome.plain ? "Show letter values" : "Hide letter values",
      "data-tip": chrome.plain
        ? "Letter values are off.\nTap to show what each letter scores."
        : "Letter values are on.\nTap to hide them and just find the word.",
      onclick: () => on.togglePlain(),
    },
    h("span", {}, "A"),
    chrome.plain ? null : h("span", { class: "plain-toggle-value" }, "1"),
  )
}

function hud(state: RunState, on: Handlers): HTMLElement {
  const round = state.round
  return h(
    "header",
    { class: "hud" },
    h(
      "div",
      { class: "hud-round" },
      h("div", { class: "round-name" }, ROUND_NAMES[state.roundIndex] ?? ""),
      // "Stage 9/8" is nonsense, and so is any denominator once the run is past
      // the last authored one. A won run counts up instead of counting down.
      h(
        "div",
        { class: "stage" },
        state.won ? `Stage ${state.stage} ∞` : `Stage ${state.stage}/${STAGES}`,
        // The terms the whole run is being played under, in the space of two
        // characters. It shares its colour with the boss banner because it is
        // the same kind of fact — something bending what a guess may be — and
        // the rules it stands for are named in full on every intro card.
        state.ascension ? h("span", { class: "stage-asc" }, `A${state.ascension}`) : null,
      ),
    ),
    h(
      "div",
      { class: `hud-score ${round.score >= round.target ? "met" : ""}` },
      h("div", { class: "score" }, num(round.score)),
      h("div", { class: "target" }, `of ${num(round.target)}`),
      // The same fact as the two numbers above it, in the form a glance can take
      // in. The scoring animation drives it frame by frame, so it fills as the
      // total climbs rather than jumping to the answer.
      h(
        "div",
        { class: "meter" },
        h("div", { class: "meter-fill", style: `--fill:${meterFill(round.score, round.target)}` }),
      ),
    ),
    h("div", { class: "hud-gold" }, money(state.gold)),
    menuButton(on),
  )
}

/** Shared with the animation controller, so the bar and the number agree. */
export const meterFill = (score: number, target: number): number =>
  target > 0 ? Math.min(1, score / target) : 1

function relicRow(state: RunState, on: Handlers): HTMLElement {
  // The tray draws as many seats as the run actually has, so ascension 8 reads
  // as four slots rather than as a fifth that silently refuses every purchase.
  const slots = Array.from({ length: difficultyOf(state).relicSlots }, (_, slot) => {
    const instance = state.relics[slot]
    if (!instance) return h("div", { class: "relic empty" })
    const relic = RELIC_BY_ID.get(instance.id)
    if (!relic) return h("div", { class: "relic empty" })
    // What a scaling relic has grown to. A card whose value moves and does not
    // say so is a card the player cannot plan around, so it goes on the face
    // rather than only in the tip.
    const detail = relic.detail?.(instance)
    return h(
      "button",
      {
        class: `relic rarity-${relic.rarity}`,
        "data-slot": slot,
        // Read by the hover tip. It lives on the card rather than in a nested
        // element because the tray clips its own children — the panel that
        // shows this has to be built outside it, and so cannot inherit either.
        // The name is left out: it is already on the card the tip points at.
        "data-tip": detail ? `${relic.text} (${detail})` : relic.text,
        "data-rarity": relic.rarity,
        type: "button",
        onclick: () => on.inspect(`${relic.name} — ${relic.text}${detail ? ` (${detail})` : ""}`),
      },
      h("span", { class: "relic-name" }, relic.name),
      detail ? h("span", { class: "relic-detail" }, detail) : null,
    )
  })
  return h("div", { class: "relics" }, ...slots)
}

function consumableRow(state: RunState, on: Handlers): HTMLElement | null {
  if (state.consumables.length === 0) return null
  const cards = state.consumables.map((instance, index) => {
    const card = CONSUMABLE_BY_ID.get(instance.id)
    return h(
      "button",
      {
        class: "consumable",
        type: "button",
        onclick: () => on.useConsumable(index),
      },
      h("span", { class: "consumable-name" }, card?.name ?? instance.id),
      h("span", { class: "consumable-text" }, card?.text ?? ""),
    )
  })
  return h("div", { class: "consumables" }, ...cards)
}

/* --------------------------------------------------------------- the round */

function grid(state: RunState, coach: CoachStep | null, on: Handlers): HTMLElement {
  const round = state.round
  const width = round.answer.length
  const active = round.guesses.length
  const modsOff = getBoss(round.bossId)?.noModifiers ?? false

  const rows = Array.from({ length: round.maxGuesses }, (_, row) => {
    const played = round.guesses[row]

    const tiles = Array.from({ length: width }, (_, column) => {
      if (played) {
        const tile = played.tiles[column]
        // Marked on played tiles only. The draft row is patched in place rather
        // than rebuilt — see `patchDraft` — and anything drawn there would have
        // to be reproduced by that patch to survive the next keystroke.
        return h(
          "div",
          {
            class: `tile ${tile?.shown ?? "gray"}`,
            "data-tile": column,
            // The dot says "a modifier fired here", so under The Vandal, where
            // none did, there is nothing for it to say. The key keeps its pip;
            // the row is a record of what happened.
            "data-mod": tile && !modsOff ? modifierOf(state, tile.letter)?.id : undefined,
          },
          (tile?.letter ?? "").toUpperCase(),
        )
      }

      if (row === active && !round.done) {
        const typed = round.draft[column]
        if (typed) {
          // Only the tile at the end of the draft lands. The board is rebuilt on
          // every keystroke, so animating `.filled` would replay the whole word
          // each time a letter is added to it.
          const landed = column === round.draft.length - 1
          return h("div", { class: `tile filled ${landed ? "land" : ""}` }, typed.toUpperCase())
        }
        // The Oracle's reveals sit in place as ghosts, so the hint is spatial
        // rather than a line of text the player has to hold in their head.
        const revealed = round.revealed[column]
        if (revealed) return h("div", { class: "tile ghost" }, revealed.toUpperCase())
      }

      return h("div", { class: "tile" })
    })

    // The boss's line about this row, laid over it rather than beside it. There
    // is no "beside": the board is `min(100%, …)` of the wrap, so on a portrait
    // phone it is as often width-bound as height-bound and a gutter that exists
    // on one device is clipped on the next. Over the tiles' bottom edge always
    // has room, and under The Silence the row it covers is grays and greens.
    const note = played?.note
      ? [
          h(
            "span",
            { class: "row-note", "data-tip": getBoss(state.round.bossId)?.text },
            played.note,
          ),
        ]
      : []

    return h("div", { class: "row", "data-row": row }, ...tiles, ...note)
  })

  // The board's shape varies — The Clock takes two rows away — so its
  // proportions are data, not a constant the stylesheet can hard-code.
  return h(
    "div",
    { class: "grid-wrap" },
    h("div", { class: "grid", style: `--rows:${round.maxGuesses};--cols:${width}` }, ...rows),
    // The coaching card, laid over the board's unplayed rows. See `coachSlot`
    // for why this is the one place on the round screen with room for it.
    coachSlot(coach, on),
  )
}

/**
 * Where the first round explains itself.
 *
 * Inside the board rather than anywhere else on the screen, because there is
 * nowhere else: measured at 390×844 the round screen runs board 115–567,
 * category 573–590, readout 596–630, solve hint 636–656, keyboard 662–836.
 * Between the board's bottom edge and the keyboard there are twenty pixels of
 * gap and three lines of numbers, and the card is about those numbers — putting
 * it there would mean covering the thing it is pointing at. The strip above the
 * keyboard is already spoken for by the toast, which is where a refusal lands.
 *
 * The board is the opposite: at the moment each beat fires, the rows below the
 * one being typed are empty by definition, so the card is laid over blank
 * squares and nothing the player needs is hidden. It costs no layout either — it
 * is absolutely positioned inside `.grid-wrap` — so the board does not resize
 * when the card appears, which on this screen would be the board *moving*.
 *
 * The slot is always in the document, empty or not, for `fillCategory`'s
 * reason: the draft row is patched rather than re-rendered, the card's text
 * changes with the letters being typed, and a node that came and went would
 * leave the patch with nowhere to write.
 */
function coachSlot(coach: CoachStep | null, on: Handlers): HTMLElement {
  const slot = h("div", { class: "coach-slot" })
  fillCoach(slot, coach, on)
  return slot
}

/**
 * Refill the coaching card. Called on every keystroke, like `fillCategory` and
 * `fillReadout`, because two of the five beats are about the word being typed —
 * one of them quotes its running chip count — and a card a keystroke behind the
 * number it is pointing at would be teaching the wrong lesson.
 */
export function fillCoach(slot: Element, coach: CoachStep | null, on: Handlers): void {
  slot.replaceChildren()
  if (!coach) return
  slot.append(
    h(
      "div",
      { class: "coach", "data-step": coach.id },
      h("p", { class: "coach-text" }, coach.text),
      // One press ends the whole tutorial rather than advancing it, and it says
      // so: "skip" on a five-card sequence would otherwise read as "next".
      h(
        "button",
        {
          class: "coach-skip",
          type: "button",
          "aria-label": "Stop showing tips",
          onclick: () => on.skipCoach(),
        },
        "got it",
      ),
    ),
  )
}

/**
 * Everything acting on one letter, in a sentence or four.
 *
 * The key already carries two marks — a `+N` for the upgrades and a pip for the
 * modifier — and marks are a reminder, not an explanation. A player who has
 * bought an etching, levelled a range and dropped a Lucky on the same letter is
 * looking at `+3` and `?` and has no way to find out what either came from
 * without leaving the round.
 *
 * The headline is the boss-adjusted figure rather than the raw one, because the
 * question is what this letter pays *now*: under The Rust every upgraded letter
 * on the board is quietly worth less than its pip claims, and this is where that
 * gets said. The breakdown below it is the honest arithmetic, and it is left off
 * entirely when there is nothing to break down.
 */
function letterTip(state: RunState, letter: string): string {
  const upper = letter.toUpperCase()
  if (state.letters[letter]?.destroyed) return `${upper} · broken, no longer typeable`

  const base = LETTER_CHIPS[letter] ?? 0
  const etch = state.letters[letter]?.etch ?? 0
  const range = rangeOf(letter)
  const fromRange = rangeChips(state, letter)
  const boss = getBoss(state.round.bossId)
  // `draftChips` prices a one-letter draft, which is to say the first column —
  // fine for a boss that reads the letter, wrong for one that reads the column.
  // Under The Margin every key would announce "no chips", which is true of the
  // column it was asked about and false of the letter. So a positional boss gets
  // the letter's own value in the headline and says the rest in its own words.
  const now = boss?.positional ? baseChips(state, letter) : draftChips(state, letter)

  const lines = [`${upper} · ${now === 0 ? "no chips" : `${now} chip${now === 1 ? "" : "s"}`}`]

  if (etch > 0 || fromRange > 0) {
    const parts = [`${base} base`]
    if (etch > 0) parts.push(`+${etch} etched`)
    if (fromRange > 0 && range) {
      parts.push(`+${fromRange} from ${range.name} Lv ${rangeLevelOf(state, range.id)}`)
    }
    lines.push(parts.join(" "))
  }

  // Only when the boss actually moved this letter — naming a boss that is not
  // touching it would make every key look cursed. A positional one is always
  // named, since the headline above it deliberately stopped accounting for it.
  if (boss && (boss.positional || now !== baseChips(state, letter))) {
    lines.push(`${boss.name}: ${boss.text}`)
  }

  const mod = modifierOf(state, letter)
  // Under The Vandal the modifier is still bought, still placed and still worth
  // reading — it just will not fire this round, and the tip is the one place
  // that can say which of those two things is true.
  if (mod) {
    lines.push(
      boss?.noModifiers
        ? `${mod.name} · ${mod.text} — silenced this round`
        : `${mod.name} · ${mod.text}`,
    )
  }
  return lines.join("\n")
}

function keyboard(state: RunState, on: Handlers): HTMLElement {
  const colors = keyboardColors(state.round.guesses)
  const eliminated = new Set(state.round.eliminated)
  // The Vandal. The pip stays — the modifier has not gone anywhere, and hiding
  // it would make the round look like it had eaten the purchase — but it greys
  // out, which is the same thing a broken key already does to it.
  const modsOff = getBoss(state.round.bossId)?.noModifiers ?? false

  const key = (letter: string) => {
    const destroyed = state.letters[letter]?.destroyed ?? false
    // Both upgrade lines in one number, because the key is answering "what is
    // this letter worth" and a player choosing a letter does not care which
    // purchase paid for it. Etchings and range levels crosscut, so most upgraded
    // keys are carrying some of each.
    const etch = (state.letters[letter]?.etch ?? 0) + rangeChips(state, letter)
    const color = eliminated.has(letter) ? "gray" : colors.get(letter)
    // A modifier is bought once and paid off over the rest of the run, so the
    // key it lives on is the only place a player can be reminded it is there —
    // at the moment they are choosing whether to spend a letter on this guess.
    const mod = modifierOf(state, letter)
    return h(
      "button",
      {
        class: ["key", color ?? "", destroyed ? "broken" : "", etch > 0 ? "etched" : ""]
          .filter(Boolean)
          .join(" "),
        "data-mod": mod?.id,
        "data-tip": letterTip(state, letter),
        type: "button",
        disabled: destroyed,
        onclick: () => on.key(letter),
      },
      letter.toUpperCase(),
      etch > 0 ? h("span", { class: "etch-pip" }, `+${etch}`) : null,
      mod ? h("span", { class: `mod-pip${modsOff ? " silenced" : ""}` }, mod.pip) : null,
    )
  }

  return h(
    "div",
    { class: "keyboard" },
    ...KEY_ROWS.map((row, index) =>
      h(
        "div",
        { class: "key-row" },
        index === 2 &&
          h("button", { class: "key wide", type: "button", onclick: () => on.enter() }, "ENTER"),
        ...[...row].map(key),
        index === 2 &&
          h("button", { class: "key wide", type: "button", onclick: () => on.back() }, "DEL"),
      ),
    ),
  )
}

/**
 * What solving on this guess is worth, right now.
 *
 * The solve bonus multiplies everything banked this round, so the decision the
 * whole game turns on — cash out or farm another guess — is arithmetic the
 * player would otherwise have to do in their head, against a multiplier that
 * shrinks every time they guess. Showing it is the difference between a
 * gamble and a choice.
 *
 * The figure is a floor, not a prediction: it is what the pile is already worth
 * multiplied, before the solving guess adds its own chips. Solving can only beat
 * it, never miss it, which is what makes it safe to act on.
 *
 * The factor comes from the engine rather than from `maxGuesses` arithmetic here,
 * so The Long Game and The Auditor move this line as well as the score.
 *
 * Returns the box whether or not it has anything to say, for the reason
 * `categorySlot` does — and this one was worse. The line goes quiet the instant
 * the round is `done`, and `submit` keeps the board on screen through the whole
 * reveal after that (`render("round")`), so the 20px it was holding came out of
 * the grid on the guess that ended the round. Measured at 390×640, where the
 * board is bound by height: the grid went 275px to 301px and every tile 41.7px
 * to 46.1px, mid-flip, on the one guess the player is watching hardest. The
 * board is centred, so on a taller screen it slid instead of growing; neither is
 * something the round should do as it ends.
 */
function solveHint(state: RunState): HTMLElement {
  const round = state.round
  const factor = solveBonusFor(state, round.maxGuesses - round.guesses.length - 1)
  if (round.done || round.guesses.length >= round.maxGuesses || factor < 1) {
    return h("div", { class: "solve-hint" })
  }

  const floor = Math.round(round.score * factor)
  const clears = floor >= round.target
  return h(
    "div",
    { class: `solve-hint ${clears ? "clears" : ""}` },
    h("span", { class: "solve-factor" }, `solve ×${factor}`),
    round.score > 0 &&
      h("span", { class: "solve-floor" }, clears ? `→ ${num(floor)}, clears` : `→ ${num(floor)}`),
  )
}

/**
 * What shape of word is on the board, and what that shape is currently worth.
 *
 * Balatro names the hand you have selected before you play it, and that label is
 * how a player learns the hand list without being taught it. This is the same
 * job: a category at level one pays nothing, so without this line there would be
 * no way to discover the system exists until after buying into it.
 *
 * Reads the draft once it is a full word, and otherwise the last guess — the
 * same rule the readout beside it follows, so the two never disagree about which
 * word they are describing.
 */
export function wordInPlay(state: RunState): string {
  const round = state.round
  const last = round.guesses[round.guesses.length - 1]
  const word = round.draft.length === round.answer.length ? round.draft : (last?.word ?? "")
  return word.length === round.answer.length ? word : ""
}

/**
 * Where the shape of the word in play is named.
 *
 * The slot is always in the document, empty or not, because the draft row is
 * patched in place rather than re-rendered — see `patchDraft` — and this line
 * has to keep up with it. A line that appeared and vanished with the word would
 * mean the patch had to know where to reinsert it; an empty div costs nothing
 * and gives it somewhere to write.
 */
function categorySlot(state: RunState, on: Handlers): HTMLElement {
  const slot = h("div", { class: "category-slot" })
  fillCategory(slot, state, on)
  return slot
}

/**
 * Refill the slot from the word now in play. Called on every keystroke, so it
 * does the least it can: nothing at all until the draft is a whole word, which
 * is the first moment there is a shape to name.
 */
export function fillCategory(slot: Element, state: RunState, on: Handlers): void {
  slot.replaceChildren()
  const word = wordInPlay(state)
  if (!word) return

  const category = categoryOf(word)
  const bonus = levelBonus(state, category)
  // A button rather than a div, because this line is the only place the shape
  // system announces itself during a round, and a player who wants to know what
  // the other four shapes are has nowhere else to press.
  slot.append(
    h(
      "button",
      { class: "category", type: "button", onclick: () => on.openShapes() },
      h("span", { class: "category-name" }, category.name),
      h("span", { class: "category-level" }, `Lv ${bonus.level}`),
      bonus.chips > 0 &&
        h("span", { class: "category-bonus" }, `+${bonus.chips} +${bonus.mult} mult`),
      h("span", { class: "category-more" }, "shapes ›"),
    ),
  )
}

/**
 * The chips × mult line, which answers a different question while a word is
 * being typed than it does once one has been played.
 *
 * Between guesses it holds the last guess, so the number the player just earned
 * is still on screen while they think. From the first letter typed it switches
 * to the word being built, and that is the whole point of it: the choice of
 * which word to spend a guess on is partly a scoring choice, and a board that
 * only reveals the chips *after* the guess is spent makes that choice round.
 *
 * Only the chips half moves. Mult comes entirely from colour, and colour is the
 * thing the player is trying to find out, so there is genuinely nothing
 * truthful to put there — hence the placeholder rather than a 1 or a stale
 * figure, either of which would read as a promise the board cannot keep. Saying
 * "unknown" out loud also teaches the rule the readout is built on: chips are
 * the letters you chose, mult is what the answer thinks of them.
 */
function readoutSlot(state: RunState): HTMLElement {
  const el = h("div", { class: "readout" })
  fillReadout(el, state)
  return el
}

/**
 * Refill the readout from the word in play. Called on every keystroke, like
 * `fillCategory`, and split out for the same reason: the draft row is patched
 * rather than re-rendered, and a readout that only caught up on the next full
 * render would lag the letters it is counting.
 */
export function fillReadout(el: Element, state: RunState): void {
  const round = state.round
  const drafting = !round.done && round.draft.length > 0
  const last = round.guesses[round.guesses.length - 1]
  el.classList.toggle("drafting", drafting)
  el.replaceChildren(
    h(
      "span",
      { class: "chips" },
      num(drafting ? draftChips(state, round.draft) : (last?.chips ?? 0)),
    ),
    h("span", { class: "times" }, "×"),
    drafting
      ? h(
          "span",
          {
            class: "mult pending",
            "data-tip": "Colour is the multiplier. Guessing is how you find it out.",
          },
          "?",
        )
      : h("span", { class: "mult" }, num(last?.mult ?? 1)),
  )
}

export function roundView(state: RunState, on: Handlers, chrome: Chrome): HTMLElement {
  const boss = getBoss(state.round.bossId)
  return h(
    "div",
    { class: "screen round-screen" },
    hud(state, on),
    boss && h("div", { class: "boss" }, h("strong", {}, boss.name), h("span", {}, ` ${boss.text}`)),
    relicRow(state, on),
    consumableRow(state, on),
    grid(state, chrome.coach, on),
    categorySlot(state, on),
    // The toggle is the readout's sibling and not its child on purpose:
    // `fillReadout` calls `replaceChildren` on every keystroke, so a button
    // inside that element would be rebuilt — and lose a press mid-tap — five
    // times a word.
    h("div", { class: "readout-row" }, readoutSlot(state), plainToggle(on, chrome)),
    solveHint(state),
    h("div", { class: "relic-tip" }),
    h("div", { class: "toast" }),
    keyboard(state, on),
  )
}

/* --------------------------------------------------------- the round intro */

/**
 * The beat between the shop and the board. It exists for pacing — the player
 * arrives at a round having decided what to buy, and this is where they read
 * what they are walking into before the keyboard demands anything of them.
 */
export function introView(state: RunState, on: Handlers, chrome: Chrome): HTMLElement {
  const boss = getBoss(state.round.bossId)
  const name = ROUND_NAMES[state.roundIndex] ?? "Round"

  // Three rounds, three tokens. The shape carries the warning before the name is
  // read, which matters most for the one that changes the rules.
  const token = boss ? "boss" : state.roundIndex === 0 ? "normal" : "elite"

  return h(
    "div",
    { class: "screen center intro", onclick: () => on.play() },
    h(
      "div",
      { class: "intro-stage" },
      state.won ? `Stage ${state.stage} · endless` : `Stage ${state.stage} of ${STAGES}`,
    ),
    h(
      "div",
      { class: `intro-card ${boss ? "boss-card" : ""}` },
      h("div", { class: `round-token ${token}` }),
      h("div", { class: "intro-name" }, boss ? boss.name : name),
      boss && h("div", { class: "intro-rule" }, boss.text),
      h("div", { class: "intro-label" }, "Score at least"),
      h("div", { class: "intro-target" }, num(state.round.target)),
      h(
        "div",
        { class: "intro-meta" },
        // The payout the run will actually be handed, not the one the table
        // lists: ascension 6 takes a dollar off it, and a card that promises $3
        // before a round and pays $2 after it is the worst kind of wrong.
        `${state.round.maxGuesses} guesses · reward ${money(
          Math.max(0, (ROUND_PAYOUT[state.roundIndex] ?? 0) - difficultyOf(state).payoutCut),
        )}`,
      ),
      standing(state),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.play() }, "Play"),
    muteButton(on, chrome),
  )
}

/**
 * The run's own rules, named on the card that announces the round.
 *
 * Named rather than spelled out: at the top of the ladder that would be six
 * sentences competing with the target for a card meant to be read in a second,
 * and every one of them was read in full on the title screen before the run
 * started. The names are the reminder; the codex has the wording; and the toast
 * that refuses a guess says exactly what was broken, which is the moment the
 * detail is actually wanted.
 */
function standing(state: RunState): HTMLElement | null {
  const rules = rulesFor(state)
  if (rules.length === 0) return null
  const { targets } = difficultyOf(state)
  return h(
    "div",
    { class: "intro-asc" },
    h("strong", {}, `Ascension ${state.ascension}`),
    ` · ${rules.map((rule) => rule.name).join(" · ")}`,
    // The endless half of the ladder, said as the number it is. `rulesFor`
    // deliberately does not return those rungs, and this is why: a run at
    // ascension 30 would otherwise put twenty copies of "Steeper" on this card,
    // when the one thing the player needs off it is how much the targets moved.
    targets > 1 ? ` · targets ×${targets.toFixed(2)}` : null,
  )
}

function muteButton(on: Handlers, chrome: Chrome): HTMLElement {
  return h(
    "button",
    {
      class: "mute",
      type: "button",
      // The card behind this is itself a tap target; without stopping here the
      // toggle would also start the round.
      onclick: (event: Event) => {
        event.stopPropagation()
        on.mute()
      },
    },
    chrome.muted ? "Sound off" : "Sound on",
  )
}

/* -------------------------------------------------------------- the reward */

export function rewardView(state: RunState, on: Handlers): HTMLElement {
  const reward = state.reward
  const line = (label: string, amount: number) =>
    h("div", { class: "reward-line" }, h("span", {}, label), h("span", {}, money(amount)))

  return h(
    "div",
    { class: "screen center" },
    h("h1", { class: "banner win" }, "Round cleared"),
    h(
      "div",
      { class: "panel" },
      h("div", { class: "answer-note" }, `The word was ${state.round.answer.toUpperCase()}`),
      h("div", { class: "score-note" }, `${num(state.round.score)} of ${num(state.round.target)}`),
      reward && line(ROUND_NAMES[state.roundIndex] ?? "Round", reward.base),
      reward && reward.unusedGuesses > 0 && line("Unused guesses", reward.unusedGuesses),
      reward && reward.interest > 0 && line("Interest", reward.interest),
      reward &&
        h(
          "div",
          { class: "reward-line total" },
          h("span", {}, "Total"),
          h("span", {}, money(reward.total)),
        ),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.collect() }, "Collect"),
  )
}

/* ---------------------------------------------------------------- the shop */

/**
 * What a card says about itself. Split out from the card because a pack lays out
 * the same items the shop sells, and a Steel E ought to read identically whether
 * it is being bought or being chosen.
 *
 * The tag is the answer to a question the shelf was not answering. Seven kinds of
 * thing are sold here and every one of them was the same rectangle — a name, a
 * sentence, a price — so "The Mint" and "Etch Heavy" were distinguishable only by
 * reading both sentences and knowing the game well enough to classify them. The
 * tag says the kind in one word before the name is read, and for the two kinds
 * that need somewhere to live it says when there is nowhere: a relic bought into
 * a full tray is refused at the till, and that refusal belongs on the card rather
 * than in a toast after the tap.
 *
 * Rarity stays a colour and never becomes a word. Relics were the exception —
 * "Uncommon Relic", on the grounds that rarity is an economy there — but a tag
 * that says two things says the second one second, and the kind is what the tag
 * is for. The card was already announcing its rarity three ways over: the
 * border, the tag's own ink, and the tray the relic is bound for. The word was
 * the fourth telling, and the only one charging the name room on the line.
 *
 * The tip is the sentence behind the tag. One word is enough to sort five cards
 * into kinds and not nearly enough to say what a kind *is* — "Alphabet" names
 * nothing to a player who has not already bought one — so the ticket answers the
 * question it provokes when it is hovered or held.
 *
 * One line, and deliberately shorter than the card it hangs off. It says how
 * that kind of thing works and stops: not what this card does, which the body
 * copy under it is already saying, and not the fine print, which is what the
 * rules sheet and the codex are for. A panel that has to be *read* is one the
 * player has stopped hovering by the end of — it covers the shelf it is
 * explaining while it does it — so anything that would not fit in a breath was
 * dropped rather than compressed. The test holds the length.
 */
export function describeItem(
  item: ShopItem,
  state: RunState,
): { title: string; text: string; rarity: string; tag: string; tip: string; blocked: boolean } {
  let title = ""
  let text = ""
  let rarity = "common"
  let tag = ""
  /**
   * Written as one line each. The tip panel is `white-space: pre-line`, so a
   * wrapped template literal would arrive with the source's own line breaks in
   * it.
   */
  let tip = ""
  /** The tag is a warning rather than a label: this one has nowhere to go. */
  let blocked = false

  if (item.kind === "pack") {
    const pack = PACK_BY_ID.get(item.id)
    title = pack?.name ?? "Pack"
    text = pack?.text ?? ""
    // Packs read as the rare thing on the shelf because they are the dearest and
    // the only one that asks a question back.
    rarity = "rare"
    tag = "Pack"
    tip = `It deals its cards face up, and you keep ${(pack?.picks ?? 1) > 1 ? pack?.picks : "one"} of them free.`
  } else if (item.kind === "relic") {
    const relic = RELIC_BY_ID.get(item.id)
    title = relic?.name ?? item.id
    text = relic?.text ?? ""
    rarity = relic?.rarity ?? "common"
    blocked = state.relics.length >= difficultyOf(state).relicSlots
    tag = blocked ? "Relic · tray full" : "Relic"
    // What separates it from everything else on the shelf, in one clause: it is
    // never used up and never used at all. The slot count is a number the tray
    // under it is already showing, so it stays out of here.
    tip = "You keep it for the whole run, and it works on its own every round."
  } else if (item.kind === "consumable") {
    const card = CONSUMABLE_BY_ID.get(item.id)
    title = card?.name ?? item.id
    text = card?.text ?? ""
    blocked = state.consumables.length >= CONSUMABLE_SLOTS
    // "Card" was what this line called itself, and a shelf where every item is
    // drawn as a card had no way to hear that as a kind. The word that says the
    // mechanic is the one the code has used all along: it is consumed.
    tag = blocked ? "Consumable · slots full" : "Consumable"
    tip = "You use it once, whenever you like, and then it is gone."
  } else if (item.kind === "mod") {
    const mod = MODIFIER_BY_ID.get(item.id)
    rarity = mod?.rarity ?? "common"
    // One sentence for both versions of this card. The difference between them,
    // which is who picks the letter, is already the difference between the two
    // titles, and the tip is about the kind rather than about the card.
    tip = "It sticks to one letter for the rest of the run."
    if (item.letter === undefined) {
      // The shop's version: a card with no letter on it yet. Named for what it
      // is being bought as — a choice — because the price is the price of the
      // choice, and the letter it ends up on is the next screen. The qualifier
      // sits after the name rather than reading as a verb ("Gold a letter"),
      // and it is what tells this card apart from the pack's aimed one at a
      // glance: "Gold E" is a letter, "Gold · any letter" is a decision.
      title = `${mod?.name ?? item.id} · any letter`
      text = `Choose any letter. It ${mod?.text ?? ""}`
      if (mod?.letters) text += `, from ${[...mod.letters].join(" ").toUpperCase()}`
      tag = "Letter"
    } else {
      const letter = item.letter.toUpperCase()
      title = `${mod?.name ?? item.id} ${letter}`
      text = `${letter} ${mod?.text ?? ""}`
      // A letter holds one modifier, so this is sometimes a trade rather than an
      // addition — and that has to be legible before the gold is gone.
      const current = state.letters[item.letter]?.mod
      if (current && current !== item.id) {
        text += `, replacing ${MODIFIER_BY_ID.get(current)?.name ?? current}`
      }
      // The pack's aimed version. Still a letter card, and the tag says so for
      // the same reason it does in the shop: the name reads "Gold E", which is
      // the letter, not the kind of thing being handed over.
      tag = "Letter"
    }
  } else if (item.kind === "range") {
    const range = RANGE_BY_ID.get(item.id)
    // Named the same way a category level is — the level it buys, not the one
    // you hold — because the gold buys the step.
    title = range ? `${range.name} → Lv ${rangeLevelOf(state, item.id) + 1}` : "Range"
    text = range ? `${range.name} letters are worth +${CHIPS_PER_LEVEL} chips per level` : ""
    tag = "Alphabet"
    tip = "It levels a slice of the alphabet, so every letter in it is worth more."
  } else if (item.kind === "level") {
    const category = CATEGORY_BY_ID.get(item.id)
    // Named as the level it buys rather than as the level you hold, because the
    // gold buys the step and the step is what the price is for.
    title = category ? `${category.name} → Lv ${levelOf(state, item.id) + 1}` : "Level"
    text = category
      ? `${category.name} words score +${category.chips} chips and +${category.mult} mult per level`
      : ""
    // "Shape" rather than "Category", because that is the word the board, the
    // shop's own levels line and the panel behind it all use for this.
    tag = "Word shape"
    tip = "It levels one shape of word, so every guess of that shape pays more."
  } else {
    // Falls back to something readable rather than to `undefined`, so a save
    // written before etchings were sold by the group degrades quietly.
    const etching = ETCHING_BY_ID.get(item.id)
    title = etching?.name ?? "Etching"
    text = etching?.text ?? ""
    tag = "Etching"
    tip = "It adds chips to a group of letters for good, and buying it again stacks."
  }

  return { title, text, rarity, tag, tip, blocked }
}

function shopItemCard(item: ShopItem, index: number, state: RunState, on: Handlers): HTMLElement {
  const affordable = state.gold >= item.cost
  const { title, text, rarity, tag, tip, blocked } = describeItem(item, state)

  return h(
    "button",
    {
      class: `shop-item kind-${item.kind} rarity-${rarity} ${item.kind === "pack" ? "pack" : ""} ${
        affordable ? "" : "broke"
      }`,
      // The stock deals in one card at a time rather than appearing all at once,
      // which is what makes a reroll feel like being dealt a new hand.
      style: `--deal:${index}`,
      type: "button",
      onclick: () => on.buy(index),
    },
    shopItemHead(title, tag, blocked, tip, rarity),
    h("div", { class: "shop-item-text" }, text),
    h("div", { class: "shop-item-cost" }, money(item.cost)),
  )
}

/**
 * The name, with the kind ticketed off to the right of it on the same line.
 *
 * The tag used to have a row of its own above the name, and on a two-column
 * shelf that row cost the card a line of the body copy the purchase is actually
 * decided on. Beside the name it reads as the ticket on the shelf edge rather
 * than as a second title, and the line it was taking goes back to saying what
 * the thing does.
 *
 * Baseline-aligned rather than centred, so a long name and a long tag —
 * "Consumable · slots full" is the worst pair the shelf can deal — still sit on
 * one line of type, with the tag wrapping under itself in the corner rather than
 * dragging the name off its own baseline. An empty `tag` means no ticket, which
 * is how a pack asks for the name on its own.
 *
 * The tip hangs off the ticket rather than off the whole card, because the card
 * is a buy button: a panel that opened over the shelf every time the pointer
 * crossed a price would be in the way of the thing it is explaining. An empty
 * `tip` leaves the ticket inert, which is what the pack sheet asks for — its
 * backdrop sits above the tip's layer, so a tip raised from inside it would be
 * drawn behind the sheet that asked for it.
 *
 * The rarity rides along so the panel takes the card's own edge colour, the way
 * a relic's does from the tray.
 */
function shopItemHead(
  title: string,
  tag: string,
  blocked: boolean,
  tip: string,
  rarity: string,
): HTMLElement {
  return h(
    "div",
    { class: "shop-item-head" },
    h("div", { class: "shop-item-name" }, title),
    tag
      ? h(
          "div",
          {
            class: `shop-item-kind${blocked ? " blocked" : ""}`,
            "data-tip": tip || undefined,
            "data-rarity": tip ? rarity : undefined,
          },
          tag,
        )
      : null,
  )
}

/**
 * An open pack, laid out over the shop.
 *
 * Deliberately not the ordinary `overlay` shell: that one dismisses when the
 * backdrop is tapped, which here would forfeit a pack that has already been paid
 * for. Walking away has to be a button you meant to press.
 */
export function packView(state: RunState, on: Handlers): HTMLElement | null {
  const open = state.pack
  if (!open) return null
  const pack = PACK_BY_ID.get(open.id)
  const left = open.options.filter(Boolean).length

  return h(
    "div",
    { class: "overlay pack-overlay" },
    h(
      "div",
      { class: "sheet pack-sheet", ...SHEET_ATTRS },
      h("h2", { class: "sheet-title" }, pack?.name ?? "Pack"),
      h(
        "p",
        { class: "pack-hint" },
        open.picks > 1 ? `Choose ${open.picks} of ${left}` : `Choose one of ${left}`,
      ),
      h(
        "div",
        { class: "pack-options" },
        ...open.options.map((item, index) => {
          if (!item) return h("div", { class: "shop-item sold", style: `--deal:${index}` }, "taken")
          const { title, text, rarity, tag, blocked } = describeItem(item, state)
          return h(
            "button",
            {
              class: `shop-item kind-${item.kind} rarity-${rarity}`,
              style: `--deal:${index}`,
              type: "button",
              onclick: () => on.pickPack(index),
            },
            // A pack deals one kind of card, so on the shelf's terms the tag
            // would say "Letter" three times down a sheet whose title already
            // said Alphabet Pack. Relics used to be the exception, back when
            // their tag carried a rarity that differed option to option; now
            // that it is the bare kind, a Relic Pack would be saying "Relic"
            // three times under its own name. What is left is the case the tag
            // is not repeating anything to say: a pick that would be taken and
            // then refused, with the pack already paid for.
            //
            // No tip either, and not only because there is no tag to hang it
            // on: this sheet is a held decision, and the pack's own title has
            // already said what kind of thing is being dealt.
            shopItemHead(title, blocked ? tag : "", blocked, "", rarity),
            h("div", { class: "shop-item-text" }, text),
            // The price it would have carried in the stock, struck through: the
            // pack already charged for it, and seeing what it would have cost is
            // most of what makes opening one feel like a win.
            h("div", { class: "shop-item-cost free" }, money(item.cost)),
          )
        }),
      ),
      h(
        "div",
        { class: "shop-actions" },
        h(
          "button",
          { class: "secondary", type: "button", onclick: () => on.skipPack() },
          open.picks > 1 ? "Take no more" : "Skip",
        ),
      ),
    ),
  )
}

/**
 * The letter picker: a modifier in hand, waiting to be put somewhere.
 *
 * Shaped like the keyboard rather than like a list, because the question it
 * asks — "which letter do you actually type?" — is one the player has already
 * been answering on that exact layout all run. Each key carries what the letter
 * is worth in chips and what it is already holding, so the trade a replacement
 * would make is visible before it is made.
 *
 * No skip and no backdrop dismissal, for the reason `packView` has none: the
 * gold is spent, and every legal letter was checked before it was taken.
 */
export function placeView(state: RunState, on: Handlers): HTMLElement | null {
  const held = state.placing
  const modifier = held ? MODIFIER_BY_ID.get(held) : undefined
  if (!modifier) return null
  const allowed = new Set(placeableLetters(state, modifier))

  const key = (letter: string) => {
    const entry = state.letters[letter]
    const current = entry?.mod ? MODIFIER_BY_ID.get(entry.mod) : undefined
    return h(
      "button",
      {
        class: ["key", "place-key", entry?.destroyed ? "broken" : "", current ? "taken" : ""]
          .filter(Boolean)
          .join(" "),
        "data-mod": current?.id,
        type: "button",
        disabled: !allowed.has(letter),
        onclick: () => on.placeMod(letter),
      },
      letter.toUpperCase(),
      // What the letter pays before any of this lands. It is the number the
      // choice actually turns on: Chip on a 1-chip vowel you type every guess
      // beats Chip on a 10-chip Z you type twice a run.
      h("span", { class: "place-chips" }, num(baseChips(state, letter))),
      current ? h("span", { class: "mod-pip" }, current.pip) : null,
    )
  }

  return h(
    "div",
    { class: "overlay pack-overlay" },
    h(
      "div",
      { class: "sheet pack-sheet", ...SHEET_ATTRS },
      h("h2", { class: "sheet-title" }, modifier.name),
      h("p", { class: "pack-hint" }, `Choose a letter. It ${modifier.text}.`),
      h(
        "div",
        { class: "keyboard place-keys" },
        ...KEY_ROWS.map((row) => h("div", { class: "key-row" }, ...[...row].map(key))),
      ),
      h(
        "p",
        { class: "place-note" },
        modifier.letters
          ? `${modifier.name} only goes on ${[...modifier.letters].join(" ").toUpperCase()}.`
          : "A letter holds one modifier — choosing one that has one trades it away.",
      ),
    ),
  )
}

/**
 * The levels a run is holding, under the stock that sells more of them.
 *
 * The shop is where the decision is — "Twinned → Lv 3" for $8 is unanswerable
 * without knowing what else you have levelled — and the card itself can only
 * speak for the one shape it is selling. Always present rather than hidden
 * behind the levels being non-trivial, because the visit where you own nothing
 * is exactly the visit where you have not heard of the system.
 */
function shopShapes(state: RunState, on: Handlers): HTMLElement {
  const levelled = CATEGORIES.filter((category) => levelOf(state, category.id) > 1)
  return h(
    "button",
    { class: "shapes-line", type: "button", onclick: () => on.openShapes() },
    h("span", { class: "shapes-line-label" }, "Word shapes"),
    h(
      "span",
      { class: "shapes-line-body" },
      levelled.length > 0
        ? levelled
            .map((category) => `${category.name} Lv ${levelOf(state, category.id)}`)
            .join(" · ")
        : "all at level 1",
    ),
    h("span", { class: "shapes-line-more" }, "›"),
  )
}

export function shopView(state: RunState, on: Handlers): HTMLElement {
  const shop = state.shop
  const reroll = shop ? rerollCost(shop) : 0

  // Drawn as seats rather than as a list, the way the board draws it, because
  // the shop is the one screen where the empty ones are the point: a shelf
  // offering a $8 relic to a player who cannot see whether they have room for it
  // is asking a question with the answer off screen. Full length, so the tray
  // that has no space left looks like a tray with no space left.
  const owned = Array.from({ length: difficultyOf(state).relicSlots }, (_, slot) => {
    const instance = state.relics[slot]
    const relic = instance ? RELIC_BY_ID.get(instance.id) : undefined
    if (!instance) return h("div", { class: "relic empty" })
    return h(
      "button",
      {
        class: `relic rarity-${relic?.rarity ?? "common"}`,
        "data-tip": relic?.text ?? instance.id,
        "data-rarity": relic?.rarity ?? "common",
        type: "button",
        onclick: () => on.sell(slot),
      },
      h("span", { class: "relic-name" }, relic?.name ?? instance.id),
      h("span", { class: "sell" }, `sell ${money(sellValue(relic?.cost ?? 4))}`),
    )
  })

  return h(
    "div",
    { class: "screen shop-screen" },
    h(
      "header",
      { class: "hud" },
      h("div", { class: "hud-round" }, h("div", { class: "round-name" }, "Shop")),
      h("div", { class: "hud-gold" }, money(state.gold)),
      menuButton(on),
    ),
    h(
      "div",
      { class: "shop-items" },
      ...(shop?.items ?? []).map((item, index) =>
        item
          ? shopItemCard(item, index, state, on)
          : h("div", { class: "shop-item sold", style: `--deal:${index}` }, "sold"),
      ),
    ),
    shopShapes(state, on),
    h(
      "div",
      { class: "shop-actions" },
      h(
        "button",
        {
          class: "secondary",
          type: "button",
          disabled: state.gold < reroll,
          onclick: () => on.reroll(),
        },
        `Reroll ${money(reroll)}`,
      ),
      h(
        "button",
        { class: "primary", type: "button", onclick: () => on.nextRound() },
        "Next round",
      ),
    ),
    h(
      "div",
      { class: "owned" },
      h(
        "div",
        { class: "owned-label" },
        // The instruction only when there is something to obey it with: an empty
        // tray under "tap a relic to sell" reads as a control that is broken
        // rather than as one that has nothing to act on yet.
        `Relics ${state.relics.length}/${difficultyOf(state).relicSlots} · Consumables ${state.consumables.length}/${CONSUMABLE_SLOTS}${
          state.relics.length > 0 ? " — tap a relic to sell" : ""
        }`,
      ),
      h("div", { class: "relics" }, ...owned),
    ),
    h("div", { class: "relic-tip" }),
    h("div", { class: "toast" }),
  )
}

/* ----------------------------------------------------------- run over */

/**
 * The end of a run, whichever end it is.
 *
 * The win is a fork rather than a finish. Stage `STAGES` is where the authored
 * game stops, not where the run has to: the targets keep growing geometrically
 * and the bosses keep coming, so a build that has beaten the game can be asked
 * how far it actually goes.
 *
 * The screen says plainly that the win survives either choice, rather than
 * inventing a stake to make the fork feel weightier. It has no stake to invent —
 * nothing is wagered by playing on, and a screen that implied otherwise would be
 * lying to make a button look brave. What is really being asked is whether to
 * start something new or find out where this one breaks.
 */
export function endView(state: RunState, on: Handlers): HTMLElement {
  const offering = state.phase === "victory"
  const lost = state.phase === "game_over"
  return h(
    "div",
    { class: "screen center" },
    h(
      "h1",
      { class: `banner ${offering ? "win" : "lose"}` },
      offering ? "Run complete" : "Run over",
    ),
    h(
      "div",
      { class: "panel" },
      lost &&
        h("div", { class: "answer-note" }, `The word was ${state.round.answer.toUpperCase()}`),
      lost &&
        h(
          "div",
          { class: "score-note" },
          `${num(state.round.score)} of ${num(state.round.target)} — short by ${num(state.round.target - state.round.score)}`,
        ),
      lost &&
        state.won &&
        h("div", { class: "score-note won-note" }, `Beat stage ${STAGES} and kept going`),
      h(
        "div",
        { class: "score-note" },
        `Reached stage ${state.stage}, ${ROUND_NAMES[state.roundIndex]}`,
      ),
      cleared(state, offering),
      offering &&
        h(
          "p",
          { class: "endless-note" },
          `Stage ${STAGES} is where the game stops, not where the run has to. The win is
           yours either way — playing on only asks how far this build really goes, and
           the targets keep growing at the same rate the whole way.`,
        ),
    ),
    offering &&
      h("button", { class: "primary", type: "button", onclick: () => on.continueRun() }, "Play on"),
    h(
      "button",
      { class: offering ? "secondary" : "primary", type: "button", onclick: () => on.newRun() },
      offering ? "Bank the win" : "New run",
    ),
  )
}

/**
 * What the level meant, said at the end rather than only at the start.
 *
 * A win at ascension N is a different thing from a win, and the next rung is the
 * only reward for it — so the screen that offers the win is also the screen that
 * hands the next one over. The dial has always been there and every rung of it
 * is reachable, so what this line marks is earning one rather than taking it: the
 * next level is now the climb rather than a leap. A loss gets the level stated
 * flatly — it is the terms the run was played under, not a consolation.
 *
 * There is always a next one now, which is the point of the endless half: the
 * last branch is the dial's ceiling rather than the ladder's top, and nobody is
 * going to see it.
 */
function cleared(state: RunState, won: boolean): HTMLElement | null {
  const level = state.ascension ?? 0
  if (!won) return level > 0 ? h("div", { class: "score-note" }, `Ascension ${level}`) : null
  return h(
    "div",
    { class: "score-note asc-note" },
    level === 0
      ? "Ascension 1 is earned — the run can be made harder"
      : level < MAX_ASCENSION
        ? `Ascension ${level} cleared — ${level + 1} is earned`
        : `Ascension ${level} cleared. There is nothing above it.`,
  )
}

/* ----------------------------------------------------------------- title */

/**
 * Only shown when there is no run to resume. A save sends the player straight
 * back to the board instead — the title is a front door, not a toll booth, and
 * charging a tap for it every launch is exactly the friction a phone game
 * cannot afford.
 */
export function titleView(on: Handlers, chrome: Chrome, meta: MetaState): HTMLElement {
  return h(
    "div",
    { class: "screen center title" },
    h("h1", { class: "title-name" }, "5 WILD"),
    h("p", { class: "title-tag" }, "A word-guessing roguelike"),
    record(meta, on),
    ladder(on, meta),
    h("button", { class: "primary", type: "button", onclick: () => on.newRun() }, "Play"),
    h(
      "button",
      { class: "secondary", type: "button", onclick: () => on.openHelp() },
      "How to play",
    ),
    h("button", { class: "secondary", type: "button", onclick: () => on.openCodex() }, "Codex"),
    muteButton(on, chrome),
    h("p", { class: "title-build" }, buildStamp()),
  )
}

/**
 * What every run before this one added up to.
 *
 * Silent on a fresh profile: a row of zeros is worse than nothing, because it
 * tells a first-time player they are already behind on a scoreboard they have
 * not seen the game for yet. The first line appears after the first run, which
 * is also the first moment it says anything.
 *
 * Wins are dropped rather than shown as zero for the same reason, and read as a
 * count rather than as a word: "beaten" next to two other numbers is a sentence
 * pretending to be a statistic, and it is ambiguous about who beat whom.
 */
function record(meta: MetaState, on: Handlers): HTMLElement | null {
  if (meta.runs === 0) return null
  const parts = [
    `${meta.runs} run${meta.runs === 1 ? "" : "s"}`,
    ...(meta.wins > 0 ? [`${meta.wins} win${meta.wins === 1 ? "" : "s"}`] : []),
    `best stage ${meta.bestStage}`,
  ]
  // A button rather than a line with a button beside it: the summary *is* the
  // link to the long version, so there is nothing extra on the title screen and
  // the thing a player would poke at anyway is the thing that opens.
  return h(
    "button",
    { class: "title-record", type: "button", onclick: () => on.openStats() },
    parts.join(" · "),
  )
}

/**
 * The long version of the record.
 *
 * Everything here is about the player rather than about a run, which is why it
 * hangs off the title screen and not off the HUD: mid-run, "which word do you
 * type most" is a distraction, and between runs it is the only thing to read.
 *
 * `pool` is the size of the answer list, passed in rather than counted here
 * because the word lists are fetched and this module is built from content. It
 * arrives as zero before they land, and the denominator is dropped rather than
 * shown as "of 0".
 */
export function statsView(meta: MetaState, pool: number, on: Handlers): HTMLElement {
  const played = roundsPlayed(meta)
  const best = favouriteWord(meta)
  const solved = wordsFound(meta)
  const mean = meanSolve(meta)

  /** The tallest row in the chart. Never zero, so an empty chart cannot divide by it. */
  const peak = Math.max(1, meta.missed, ...meta.solves)

  const figure = (label: string, value: string) =>
    h("div", { class: "figure" }, h("strong", {}, value), h("span", {}, label))

  /**
   * Two readings of the same number, on purpose.
   *
   * The percentage is the share of every round ever played, which is the honest
   * one and is what a player would mean by "how often". The bar is drawn against
   * the tallest row instead. A distribution whose mode is 31% would otherwise
   * spend the whole chart in the left third of the track, and the shape — did the
   * answers come on the third guess or the fifth, is the peak sharp or flat — is
   * the entire reason a bar is here rather than a fourth column of digits. The
   * label carries the truth and the bar carries the shape.
   */
  const bar = (label: string, count: number, tone: string) => {
    const share = played > 0 ? count / played : 0
    return h(
      "div",
      { class: `breakdown-row ${tone}` },
      h("span", { class: "breakdown-label" }, label),
      h(
        "span",
        { class: "breakdown-track" },
        h("span", {
          class: "breakdown-fill",
          style: `--fill:${((count / peak) * 100).toFixed(1)}%`,
        }),
      ),
      h("span", { class: "breakdown-share" }, `${Math.round(share * 100)}%`),
      h("span", { class: "breakdown-count" }, num(count)),
    )
  }

  const relics = favouriteRelics(meta).slice(0, 3)

  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "Record"),
    h(
      "div",
      { class: "figures" },
      figure("runs", num(meta.runs)),
      figure(meta.wins === 1 ? "win" : "wins", num(meta.wins)),
      figure("best stage", num(meta.bestStage)),
      figure("guesses", num(meta.guesses)),
      // Three across and two down rather than four across, which is what buys the
      // second row: the top one is the run record and the bottom one is the word
      // record, and a player who wants to know whether they are getting better at
      // the game reads the bottom row. An em dash rather than a zero before any
      // round has ended — 0% solved is a claim, and this player has not made it.
      figure("solved", played > 0 ? `${Math.round((solved / played) * 100)}%` : "—"),
      figure("avg guess", mean === null ? "—" : mean.toFixed(1)),
    ),
    h(
      "p",
      { class: "stat-line" },
      h("strong", {}, `${num(meta.cracked.length)} word${meta.cracked.length === 1 ? "" : "s"}`),
      // The one collection the game has, so it is worth a denominator: "273 of
      // 2,300" is a thing to finish, and "273 words cracked" is only a number.
      pool > 0 ? ` cracked, of ${num(pool)}` : " cracked",
    ),
    best
      ? h(
          "p",
          { class: "stat-line" },
          "Most played: ",
          h("strong", {}, best.word.toUpperCase()),
          ` · ${num(best.count)} time${best.count === 1 ? "" : "s"}`,
        )
      : null,
    played > 0
      ? h(
          "div",
          { class: "breakdown" },
          h("h3", { class: "stat-head" }, "How the answers go"),
          ...meta.solves.flatMap((count, at) =>
            count > 0 ? [bar(`Solved in ${at}`, count, "won")] : [],
          ),
          meta.missed > 0 ? bar("Never found", meta.missed, "lost") : null,
          // The percentage that used to sit here is a figure now, so the foot is
          // free to say the thing a distribution structurally cannot: not how
          // often the word comes, but how long it kept coming. It is the only
          // number on this screen with any tension in it — every other one can
          // just go up.
          h("p", { class: "stat-foot" }, streakLine(meta)),
        )
      : null,
    relics.length > 0
      ? h(
          "div",
          { class: "breakdown" },
          h("h3", { class: "stat-head" }, "Favourite relics"),
          ...relics.map((entry) =>
            h(
              "p",
              { class: "stat-line" },
              h("strong", {}, RELIC_BY_ID.get(entry.id)?.name ?? entry.id),
              ` · taken ${num(entry.count)}×`,
            ),
          ),
        )
      : null,
    h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Close"),
  )
}

/**
 * The streak as a sentence, because it is two numbers that only mean something
 * beside each other.
 *
 * "14" on its own is a boast with no date on it, and "3" on its own is noise.
 * "14 in a row, 3 now" is a player being told how far they are off their own
 * best, which is the only reading that earns the field its place in the record.
 */
export function streakLine(meta: MetaState): string {
  if (meta.bestStreak === 0) return "No answer found yet."
  // Level with the record and still climbing, so there is no gap to report and
  // reporting one anyway — "14 in a row, 14 now" — reads as a bug rather than as
  // the best thing that has happened to this player.
  if (meta.streak === meta.bestStreak) {
    return `${num(meta.streak)} solved in a row, and still going — the longest yet.`
  }
  return meta.streak > 0
    ? `Longest streak: ${num(meta.bestStreak)} in a row, ${num(meta.streak)} now.`
    : `Longest streak: ${num(meta.bestStreak)} in a row.`
}

/**
 * The difficulty dial, and the only thing on the title screen that is a decision.
 *
 * Present from the first launch, and open all the way to the top. Hiding the
 * ladder until a win taught the game's best idea to exactly the players who had
 * already finished it; showing it makes ten named rules part of what the game
 * looks like, not a reward for having seen the ending.
 *
 * Above what has been won the rung wears a lock, and the lock yields. The climb
 * is still the intended shape — each rung is one new rule to learn, and the note
 * under an unearned level says so — but a player who wants to open on Tyranny is
 * making a choice about their own evening, and a disabled button is the wrong
 * answer to that. A lock that states its reason and then lets you past is worth
 * more than a `+` that stops responding and explains nothing.
 *
 * The lock is worn by the `+` itself, and only on the rung at the edge of what
 * has been earned. That works out to exactly one rung — `ahead` is true only
 * when `level === top` — and it is the only step that crosses the line, so it is
 * the only one that is a decision rather than a nudge. Above the line the `+` is
 * a plain `+` again: the player has already answered the question, and asking it
 * once a rung on the way to ascension 12 would be a door that never stops
 * closing. It sits beside the note that says what beating this rung would earn,
 * which makes the pair a straight offer — beat it, or take it now.
 *
 * A stepper rather than a list of buttons, because the ladder is ordered and
 * cumulative — the question is "how far up", not "which one" — and because the
 * ladder no longer has a length a list could have. The level's own rule is
 * spelled out under it; the ones below are named on the intro card of every
 * round, and written out in full in the codex.
 */
function ladder(on: Handlers, meta: MetaState): HTMLElement {
  const top = unlocked(meta)
  const level = chosenAscension(meta)
  const rule = ascensionAt(level)
  const locked = isLocked(meta, level)
  const ahead = level === top && level < MAX_ASCENSION
  const carrot = ahead ? `Beat this to unlock ascension ${level + 1}` : null

  const step = (label: string, to: number, live: boolean) =>
    h(
      "button",
      {
        class: "ladder-step",
        type: "button",
        disabled: !live,
        "aria-label": label === "−" ? "Lower the ascension" : "Raise the ascension",
        onclick: () => on.setAscension(to),
      },
      label,
    )

  return h(
    "div",
    { class: `ladder ${level > 0 ? "lit" : ""} ${locked ? "locked" : ""}` },
    h(
      "div",
      { class: "ladder-row" },
      step("−", level - 1, level > 0),
      h(
        "div",
        { class: "ladder-level" },
        h(
          "span",
          { class: "ladder-name" },
          // The lock rides the name rather than sitting in the note alone, so
          // the state is legible from the one line the eye lands on first.
          locked && h("span", { class: "ladder-lock", "aria-label": "Locked" }, "🔒"),
          `Ascension ${level}`,
        ),
        // The second line of the dial is "what this rung is", and at zero there
        // is no rule to be. Rather than leave the slot empty and push the carrot
        // to the foot of the box, zero says what beating it earns *here* — so
        // stepping 0 → 1 swaps one line in place instead of deleting a line from
        // the bottom and growing one in the middle.
        rule
          ? h("span", { class: "ladder-rule" }, rule.name)
          : carrot && h("span", { class: "ladder-rule forward" }, carrot),
      ),
      ahead
        ? h(
            "button",
            {
              class: "ladder-step shut",
              type: "button",
              "aria-label": `Skip to ascension ${level + 1}`,
              onclick: () => on.askAscend(level + 1),
            },
            "🔒",
          )
        : step("+", level + 1, level < MAX_ASCENSION),
    ),
    h(
      "p",
      { class: "ladder-text" },
      rule
        ? // Every level plays the rules below it as well, and saying so once here
          // is what stops the stepper reading as a menu of separate modes.
          `${rule.text}${level > 1 ? " Every rule below it, too." : ""}`
        : "The game as it is written, with nothing extra asked of you.",
    ),
    // One line under the dial, and only ever the forward-looking one: what
    // beating this rung would open. It sits here only when the rung has a rule
    // holding the line above — at zero it has already been said in the dial, and
    // saying it twice would be the box shouting the one thing it wants.
    //
    // The warning that used to displace it here is gone. It said the player had
    // not won yet, in a box whose lock says the same thing in a glyph and whose
    // sheet had just said it in a sentence, and three tellings of "you have not
    // earned this" is the screen holding a grudge about a choice it offered.
    // Above the earned rung there is now no line at all, which is the right
    // amount to say to someone who has already been asked and has already
    // answered.
    rule && carrot ? h("p", { class: "ladder-note" }, carrot) : null,
  )
}

/**
 * The lock, opened.
 *
 * Two lines: what this rung does, and that it is not the recommended way in. A
 * sheet standing between a player and a button they have already decided to
 * press earns its place by being read, and every version of this that argued its
 * case at length was skimmed instead.
 *
 * Gone from it: the line naming the rung that has not been beaten, and the one
 * promising the choice was reversible. The first was true and was the wrong
 * opening — it told the player what they had failed to do before it told them
 * anything they did not know. The second was answering a question nobody asked;
 * this is a stepper on a title screen, and a player who wants to know whether it
 * can be stepped back can step it back. Reassurance nobody needed is still a
 * line to read before the button.
 *
 * "Recommended" rather than an argument about tuning, for the same reason. It is
 * what the sentence actually means, a player can weigh it in the time it takes
 * to read, and the button beside it says "anyway" — which is the honest name for
 * the thing being pressed and carries the rest of the warning on its own.
 *
 * No disabled state, no delay, no second confirmation — the game already decided
 * a player may start anywhere, and a sheet that grudges the permission it is
 * granting is worse than no sheet.
 *
 * The rule of the rung being stepped onto is quoted rather than only its number,
 * because "ascension 8" means nothing to a player who has seen three of them and
 * "Four relic slots, not five" means something to anyone. It is the one piece of
 * information that turns this from a dare into a decision.
 *
 * It is only ever this one rung. The lock sits at the edge of what was earned,
 * so the leap it grants is always a single step, and past the edge the stepper
 * is plain again — a player who has crossed the line does not get asked about it
 * once per rung on the way to ascension 40.
 */
export function ascendView(level: number, on: Handlers): HTMLElement {
  const rule = ascensionAt(level)
  return overlay(
    on,
    h("h2", { class: "sheet-title" }, `Skip to ascension ${level}?`),
    h(
      "div",
      { class: "sheet-body" },
      rule
        ? h(
            "p",
            { class: "sheet-lead" },
            h("strong", {}, `${rule.name}: `),
            rule.text,
            level > 1 ? " Plus every rule below it." : "",
          )
        : null,
      h("p", {}, "It is recommended to win before skipping to a higher ascension."),
    ),
    h(
      "div",
      { class: "sheet-actions" },
      h(
        "button",
        { class: "danger", type: "button", onclick: () => on.ascend() },
        `Skip to ${level} anyway`,
      ),
      h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Back"),
    ),
  )
}

/**
 * What this bundle actually is, in the one place a player will look for it.
 *
 * Both halves are inlined at build time — see vite.config.ts. The version comes
 * from package.json and the hash from the commit, and the hash is the one that
 * can be trusted: Pages redeploys on every push, but the version bump is its own
 * commit landing after the change it names, so for the gap between them the site
 * serves new code under the old number. Where there is no hash to be had the
 * version stands alone rather than trailing a bare separator.
 */
function buildStamp(): string {
  const version = `v${__BUILD_VERSION__}`
  return __BUILD_COMMIT__ ? `${version} · ${__BUILD_COMMIT__}` : version
}

/* -------------------------------------------------------------- overlays */

/**
 * What every sheet wears, whichever shell built it.
 *
 * `tabindex="-1"` is the load-bearing one: it is what lets focus be *put* on the
 * sheet when it opens without putting the sheet in the tab order itself, which
 * is how the keyboard gets inside a thing that was appended to the document
 * rather than navigated to. The two ARIA attributes say the same thing to a
 * screen reader that the backdrop says to everyone else — nothing behind this is
 * available until it is dealt with.
 */
export const SHEET_ATTRS = { role: "dialog", "aria-modal": "true", tabindex: -1 }

/**
 * Everything modal shares this shell. The backdrop closes on tap, which on a
 * phone is the gesture people reach for before they look for a button.
 */
function overlay(on: Handlers, ...body: (HTMLElement | string | false | null)[]): HTMLElement {
  return h(
    "div",
    { class: "overlay", onclick: () => on.closeOverlay() },
    h(
      "div",
      {
        class: "sheet",
        ...SHEET_ATTRS,
        // Taps inside the sheet are for the sheet; without this every button
        // press would also dismiss the thing it was pressed in.
        onclick: (event: Event) => event.stopPropagation(),
      },
      ...body,
    ),
  )
}

const rule = (term: string, text: string) =>
  h("div", { class: "rule" }, h("strong", {}, term), h("span", {}, text))

export function helpView(on: Handlers): HTMLElement {
  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "How to play"),
    h(
      "div",
      { class: "sheet-body" },
      h(
        "p",
        {},
        "Guess the word, the way you already know how — green is the right letter in " +
          "the right place, yellow is the right letter somewhere else.",
      ),
      h("p", { class: "sheet-lead" }, "The difference is that every guess is scored."),
      rule("Chips × Mult", " Each guess is worth its chips multiplied by its mult."),
      rule(
        "Letters pay chips",
        ` Rare letters pay more. The shop sells two ways to raise them: etchings, which
         add to a kind of letter, and levels on a slice of the alphabet. Every letter
         sits in exactly one slice, and the two stack.`,
      ),
      rule(
        "Colours pay mult",
        ` Green is worth +3 mult, yellow +1, gray nothing. A guess full of gray is
         worth almost nothing, so a throwaway probe costs you real score.`,
      ),
      rule(
        "Solving multiplies the round",
        ` Land the word and everything you have banked this round — not just the
         guess that solved it — is multiplied by 1 + the guesses you had left.
         Then the round ends immediately, target met or not.`,
      ),
      h(
        "p",
        { class: "sheet-lead" },
        "That is the game: every guess you spend farming grows the pile, and " +
          "shrinks the multiplier waiting for it.",
      ),
      rule(
        "So watch the solve line",
        ` Under the board it shows the multiplier a solve would earn right now, and
         what the pile is already worth at it. When it turns green, solving wins
         the round.`,
      ),
      h("h3", { class: "sheet-heading" }, "The run"),
      rule(
        "Beat the target",
        ` ${STAGES} stages of ${ROUNDS_PER_STAGE} rounds. Fall short of a round's target
         and the run is over — that is the only way to lose.`,
      ),
      rule(
        "Then keep going, if you dare",
        ` Clearing stage ${STAGES} wins the run, and you can bank it there or play on into
         stages nobody balanced. The targets keep growing at the same rate, and dying out
         there does not take the win back.`,
      ),
      rule("Bosses", " Every third round bends a rule. Read it before you play."),
      rule(
        "Ascensions",
        ` The difficulty dial on the title screen, and the number worth comparing. The
         first ${AUTHORED_ASCENSIONS} levels each add one standing rule — to what you may
         guess, what a round pays, how high the targets are, how many relics you may keep,
         how many guesses you get. Above that the ladder does not end: every further level raises
         every target again. Winning at one earns the next, and climbing a rung at a time
         is the intended way up, not a lock.`,
      ),
      rule(
        "Money",
        ` Rounds pay $${ROUND_PAYOUT.join(" / $")}, plus $${GOLD_PER_UNUSED_GUESS} per
         unused guess, plus $1 interest per $${INTEREST_PER} you are holding, up to
         $${INTEREST_CAP}. Sitting on cash is a strategy.`,
      ),
      rule(
        "Relics",
        ` Up to ${RELIC_SLOTS}, and they fire left to right, so the order you buy them
         in matters. Tap one to read it.`,
      ),
      rule(
        "Packs",
        ` One slot sells a choice rather than a card. A pack lays three out and you
         keep one, free — the rest of the shop waits until you have picked or
         walked away, and walking away keeps nothing.`,
      ),
      rule(
        "Letter mods",
        ` The shop sells modifiers and you choose which letter each one sticks to for
         the rest of the run — every time you play that letter, it does this. A
         ×mult letter multiplies what the word has scored up to where it sits, so it
         is worth more late in a word than early. Packs deal them cheaper, with the
         letter already chosen for you.`,
      ),
      // The list of what each one does lives in the codex rather than here. Two
      // screens restating the same table is how the two of them drift apart, and
      // this one is meant to be read once.
      h(
        "p",
        { class: "sheet-lead" },
        "The codex has every relic, boss, word shape and modifier in the game, listed in full.",
      ),
    ),
    h(
      "div",
      { class: "sheet-actions" },
      h(
        "button",
        { class: "secondary", type: "button", onclick: () => on.openCodex() },
        "Open the codex",
      ),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Got it"),
  )
}

/* ----------------------------------------------------------------- codex */

/** One catalogue entry: what it is called, what it does, and what it costs. */
function entry(name: string, text: string, note?: string): HTMLElement {
  return h(
    "div",
    { class: "codex-entry" },
    h(
      "div",
      { class: "codex-entry-head" },
      h("strong", {}, name),
      note ? h("span", { class: "codex-note" }, note) : null,
    ),
    h("span", { class: "codex-text" }, text),
  )
}

/**
 * One collapsible section, closed until asked for.
 *
 * Everything in the codex laid out flat runs to ten phone screens of scrolling,
 * which makes the catalogue useless for the thing it is actually for — looking
 * one card up, mid-run, having forgotten what it does. Closed, the whole screen
 * is seven rows and a count, and the count is worth reading on its own: it is
 * the size of the game, stated.
 */
function section(title: string, count: number, blurb: string, ...rows: HTMLElement[]): HTMLElement {
  return h(
    "details",
    { class: "codex-section" },
    h(
      "summary",
      { class: "codex-summary" },
      h("span", {}, title),
      h("span", { class: "codex-count" }, String(count)),
    ),
    h("p", { class: "codex-blurb" }, blurb),
    ...rows,
  )
}

const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "legendary"]

const TIER_NAMES: Record<BossTier, string> = {
  early: "Early",
  mid: "Mid",
  late: "Late",
}

/**
 * The catalogue. Every section maps over the table it describes rather than
 * restating it, which is the same trick — and the same reason — as the modifier
 * list that used to live in `helpView`: a reference that is written out by hand
 * is a reference that goes stale the first time a number moves.
 *
 * Fully revealed rather than unlocked by discovery. The player who most needs to
 * read what The Auditor does is the one who has not met it yet, and a codex that
 * only tells you what you already know is a trophy cabinet, not a reference.
 *
 * Takes no run state on purpose: this is the catalogue, not the board. A scaling
 * relic shows its rule here, never the number it happens to be holding.
 */
/**
 * The five word shapes, what they are worth, and which of them the word on the
 * board is.
 *
 * The system was invisible before this. One line under the grid named the shape
 * in play; nothing named the other four, nothing listed the levels a run had
 * bought, and nothing anywhere stated the rule that decides which shape a word
 * scores as — `categoryOf` returns the *rarest* match, so a word that is both
 * Twinned and Vowel Heavy scores as Vowel Heavy and a player levelling Twinned
 * would watch it not pay and never learn why.
 *
 * So the panel says all three things at once: every shape a word matches gets a
 * tag, the one that counts gets a louder one, and the list is in the order the
 * engine checks it in. The rule is not written down anywhere the player has to
 * be told it — it is the order of the rows.
 */
export function shapesView(state: RunState, on: Handlers, word: string): HTMLElement {
  const scoring = word ? categoryOf(word) : null

  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "Word shapes"),
    h(
      "p",
      { class: "sheet-lead" },
      scoring ? `${word.toUpperCase()} scores as ${scoring.name}` : "Every guess has a shape.",
    ),
    h(
      "p",
      { class: "shapes-note" },
      "A guess scores as the rarest shape it matches, which is the first of these it " +
        "matches. Levelling a shape raises every future guess of that shape — level 1 " +
        "pays nothing, so a level is what makes a shape worth aiming at.",
    ),
    h(
      "div",
      { class: "shapes" },
      ...CATEGORIES.map((category) => {
        const bonus = levelBonus(state, category)
        const scores = scoring?.id === category.id
        const matched = !scores && word !== "" && category.matches(word)
        return h(
          "div",
          { class: `shape ${scores ? "scoring" : ""} ${matched ? "matched" : ""}` },
          h(
            "div",
            { class: "shape-head" },
            h("strong", {}, category.name),
            scores ? h("span", { class: "shape-tag" }, "scoring") : null,
            matched ? h("span", { class: "shape-tag also" }, "also matches") : null,
            h("span", { class: "shape-level" }, `Lv ${bonus.level}`),
          ),
          h("span", { class: "shape-text" }, category.text),
          h(
            "span",
            { class: "shape-pay" },
            bonus.chips > 0
              ? `now +${bonus.chips} chips, +${bonus.mult} mult`
              : `+${category.chips} chips, +${category.mult} mult per level`,
          ),
        )
      }),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Close"),
  )
}

export function codexView(on: Handlers): HTMLElement {
  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "Codex"),
    h(
      "div",
      { class: "sheet-body" },
      h("p", { class: "sheet-lead" }, "Everything in the game, whether you have met it or not."),

      section(
        "Relics",
        RELICS.length,
        `Up to ${RELIC_SLOTS} at once, firing left to right — the order you buy them in
         is part of the build.`,
        // The rarity class goes on the wrapper rather than the header, so the
        // band's colour reaches the cards under it the same way it reaches a
        // relic in the tray.
        ...RARITIES.flatMap((rarity) => {
          const relics = RELICS.filter((relic) => relic.rarity === rarity)
          if (relics.length === 0) return []
          return [
            h(
              "div",
              { class: `codex-band rarity-${rarity}` },
              h("div", { class: "codex-group" }, rarity),
              ...relics.map((relic) => entry(relic.name, relic.text, money(relic.cost))),
            ),
          ]
        }),
      ),

      section(
        "Bosses",
        BOSSES.length,
        `Every third round. Each band is drawn without replacement, so a run never
         meets the same boss twice.`,
        ...BOSS_TIERS.map((tier) =>
          h(
            "div",
            { class: "codex-band" },
            h(
              "div",
              { class: "codex-group" },
              `${TIER_NAMES[tier]} · stages ${TIER_STAGES[tier].first}–${TIER_STAGES[tier].last}`,
            ),
            ...bossesIn(tier).map((boss) => entry(boss.name, boss.text)),
          ),
        ),
      ),

      section(
        "Ascensions",
        ASCENSIONS.length,
        `The run's own difficulty, chosen before it starts and fixed for the whole of it.
         A run at a level plays every rule up to it, and winning at one unlocks the next.
         These are the written ones; past the last of them each level simply raises every
         target by another 8%, and there is no last level.`,
        ...ASCENSIONS.map((rule) => entry(rule.name, rule.text, `Ascension ${rule.level}`)),
      ),

      section(
        "Word shapes",
        CATEGORIES.length,
        `Every guess scores as exactly one shape — the rarest one it matches, which is
         the first in this list. Levelling a shape raises every future guess of it.`,
        ...CATEGORIES.map((category) =>
          entry(category.name, category.text, `+${category.chips} / +${category.mult} per level`),
        ),
      ),

      section(
        "Letter modifiers",
        MODIFIERS.length,
        `Stuck to a single letter for the rest of the run. One at a time per letter,
         and the keyboard wears the mark. A ×mult letter multiplies what the word has
         scored up to where it sits, so it is worth more late in a word than early.
         The shop price buys the card and lets you pick the letter; a pack deals it
         for the price beside it, letter already chosen.`,
        ...MODIFIERS.map((mod) =>
          entry(
            `${mod.name} ${mod.pip}`,
            `The letter ${mod.text}.${
              mod.letters ? ` Only on ${[...mod.letters].join(" ").toUpperCase()}.` : ""
            }`,
            `${money(mod.choiceCost)} / ${money(mod.cost)}`,
          ),
        ),
      ),

      section(
        "Letter upgrades",
        ETCHINGS.length + RANGES.length,
        `Two lines that both add chips to letters, and stack: etchings raise a kind of
         letter, ranges raise a slice of the alphabet. Every letter sits in exactly one
         slice.`,
        ...ETCHINGS.map((etching) => entry(etching.name, etching.text, money(etching.cost))),
        ...RANGES.map((range) =>
          entry(
            range.name,
            `${[...range.letters].join(" ").toUpperCase()} are worth +${CHIPS_PER_LEVEL} chips per level`,
          ),
        ),
      ),

      section(
        // One word for this line everywhere it is named — the shelf's ticket,
        // the shop's tray count and this heading — because a player who bought
        // a Consumable and then reads a codex full of Cards has to work out
        // that they are the same line before they can look anything up.
        "Consumables",
        CONSUMABLES.length,
        `Used once, whenever you like. You can hold ${CONSUMABLE_SLOTS}.`,
        ...CONSUMABLES.map((card) => entry(card.name, card.text, money(card.cost))),
      ),

      section(
        "Packs",
        PACKS.length,
        `Sold in a slot of their own. A pack lays its cards out and you keep one, free —
         the shop waits until you have chosen or walked away.`,
        // "Choose one of three" already says how many you keep, so the count is
        // only worth printing on a pack that keeps more than one — which none
        // do yet, and which is exactly why it is derived rather than assumed.
        ...PACKS.map((pack) =>
          entry(
            pack.name,
            pack.picks > 1 ? `${pack.text}, and keep ${pack.picks}.` : `${pack.text}.`,
            money(pack.cost),
          ),
        ),
      ),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Close"),
  )
}

export function menuView(on: Handlers, chrome: Chrome): HTMLElement {
  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "Paused"),
    h(
      "div",
      { class: "sheet-actions" },
      h(
        "button",
        { class: "secondary", type: "button", onclick: () => on.mute() },
        chrome.muted ? "Sound off" : "Sound on",
      ),
      // Music gets its own switch rather than riding on the sound one: it plays
      // continuously, so it is the thing a player is most likely to want gone
      // while keeping the feedback that tells them what their guess scored.
      //
      // Muting sound silences it too, and the switch goes dead rather than
      // sitting there reading "Music on" over silence.
      h(
        "button",
        {
          class: "secondary",
          type: "button",
          disabled: chrome.muted,
          onclick: () => on.toggleMusic(),
        },
        chrome.muted || chrome.musicOff ? "Music off" : "Music on",
      ),
      // Letter values are not here. The board is dense by design — a value on
      // every key, a pip on every modifier — and that density is the scoring
      // game asking to be played; some of the time the player is doing the other
      // thing entirely, which is working out a five-letter word, and every
      // number on screen is noise. The switch for it is `plainToggle`, sitting
      // beside the chips × mult readout, because it was the one setting on this
      // sheet whose whole effect was hidden behind the sheet while it was being
      // set — and the readout is the densest numbers on the screen, so the
      // switch is next to the thing it is loudest about.
      h(
        "button",
        { class: "secondary", type: "button", onclick: () => on.openHelp() },
        "How to play",
      ),
      h("button", { class: "secondary", type: "button", onclick: () => on.openCodex() }, "Codex"),
      h("button", { class: "danger", type: "button", onclick: () => on.askQuit() }, "Quit run"),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.closeOverlay() }, "Resume"),
  )
}

/**
 * Quitting is the one irreversible button in the game — the save is deleted and
 * a run is an hour of decisions — so it asks, and the confirmation is worded as
 * what is lost rather than as a yes/no.
 */
export function quitView(state: RunState, on: Handlers): HTMLElement {
  return overlay(
    on,
    h("h2", { class: "sheet-title" }, "Quit this run?"),
    h(
      "div",
      { class: "sheet-body" },
      h(
        "p",
        {},
        `You are on stage ${state.stage}${state.won ? "" : ` of ${STAGES}`}, ${
          ROUND_NAMES[state.roundIndex] ?? "a round"
        }. Quitting deletes it — there is no way back to this run.`,
      ),
    ),
    h(
      "div",
      { class: "sheet-actions" },
      h("button", { class: "danger", type: "button", onclick: () => on.quit() }, "Quit run"),
      h(
        "button",
        { class: "primary", type: "button", onclick: () => on.openMenu() },
        "Keep playing",
      ),
    ),
  )
}
