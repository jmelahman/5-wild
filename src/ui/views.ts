import type { RunState, ShopItem } from "../engine"
import {
  ANTES,
  BLIND_NAMES,
  BLIND_PAYOUT,
  CONSUMABLE_BY_ID,
  CONSUMABLE_SLOTS,
  getBoss,
  JOKER_BY_ID,
  JOKER_SLOTS,
  keyboardColors,
  rerollCost,
  sellValue,
} from "../engine"
import { h } from "./dom"

export type Handlers = {
  key: (letter: string) => void
  enter: () => void
  back: () => void
  useConsumable: (index: number) => void
  collect: () => void
  buy: (index: number) => void
  sell: (index: number) => void
  reroll: () => void
  nextBlind: () => void
  newRun: () => void
  inspect: (text: string) => void
  play: () => void
  mute: () => void
}

/** Presentation state the engine has no opinion about. */
export type Chrome = { muted: boolean }

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]

const money = (amount: number) => `$${amount}`

/* -------------------------------------------------------------- shared bits */

function hud(state: RunState): HTMLElement {
  return h(
    "header",
    { class: "hud" },
    h(
      "div",
      { class: "hud-blind" },
      h("div", { class: "blind-name" }, BLIND_NAMES[state.blindIndex] ?? ""),
      h("div", { class: "ante" }, `Ante ${state.ante}/${ANTES}`),
    ),
    h(
      "div",
      { class: "hud-score" },
      h("div", { class: "score" }, String(state.blind.score)),
      h("div", { class: "target" }, `of ${state.blind.target}`),
    ),
    h("div", { class: "hud-gold" }, money(state.gold)),
  )
}

function jokerRow(state: RunState, on: Handlers): HTMLElement {
  const slots = Array.from({ length: JOKER_SLOTS }, (_, slot) => {
    const instance = state.jokers[slot]
    if (!instance) return h("div", { class: "joker empty" })
    const joker = JOKER_BY_ID.get(instance.id)
    if (!joker) return h("div", { class: "joker empty" })
    return h(
      "button",
      {
        class: `joker rarity-${joker.rarity}`,
        "data-slot": slot,
        type: "button",
        onclick: () => on.inspect(`${joker.name} — ${joker.text}`),
      },
      h("span", { class: "joker-name" }, joker.name),
    )
  })
  return h("div", { class: "jokers" }, ...slots)
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

/* --------------------------------------------------------------- the blind */

function grid(state: RunState): HTMLElement {
  const blind = state.blind
  const width = blind.answer.length
  const active = blind.guesses.length

  const rows = Array.from({ length: blind.maxGuesses }, (_, row) => {
    const played = blind.guesses[row]

    const tiles = Array.from({ length: width }, (_, column) => {
      if (played) {
        const tile = played.tiles[column]
        return h(
          "div",
          { class: `tile ${tile?.shown ?? "gray"}`, "data-tile": column },
          (tile?.letter ?? "").toUpperCase(),
        )
      }

      if (row === active && !blind.done) {
        const typed = blind.draft[column]
        if (typed) return h("div", { class: "tile filled" }, typed.toUpperCase())
        // The Oracle's reveals sit in place as ghosts, so the hint is spatial
        // rather than a line of text the player has to hold in their head.
        const revealed = blind.revealed[column]
        if (revealed) return h("div", { class: "tile ghost" }, revealed.toUpperCase())
      }

      return h("div", { class: "tile" })
    })

    return h("div", { class: "row", "data-row": row }, ...tiles)
  })

  // The board's shape varies — The Clock takes two rows away — so its
  // proportions are data, not a constant the stylesheet can hard-code.
  return h(
    "div",
    { class: "grid-wrap" },
    h("div", { class: "grid", style: `--rows:${blind.maxGuesses};--cols:${width}` }, ...rows),
  )
}

function keyboard(state: RunState, on: Handlers): HTMLElement {
  const colors = keyboardColors(state.blind.guesses)
  const eliminated = new Set(state.blind.eliminated)

  const key = (letter: string) => {
    const destroyed = state.letters[letter]?.destroyed ?? false
    const etch = state.letters[letter]?.etch ?? 0
    const color = eliminated.has(letter) ? "gray" : colors.get(letter)
    return h(
      "button",
      {
        class: ["key", color ?? "", destroyed ? "burnt" : "", etch > 0 ? "etched" : ""]
          .filter(Boolean)
          .join(" "),
        type: "button",
        disabled: destroyed,
        onclick: () => on.key(letter),
      },
      letter.toUpperCase(),
      etch > 0 ? h("span", { class: "etch-pip" }, `+${etch}`) : null,
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

export function blindView(state: RunState, on: Handlers): HTMLElement {
  const boss = getBoss(state.blind.bossId)
  // The readout holds the last guess rather than resetting to 0 x 1, so the
  // number the player just earned is still on screen while they think.
  const last = state.blind.guesses[state.blind.guesses.length - 1]
  return h(
    "div",
    { class: "screen blind-screen" },
    hud(state),
    boss && h("div", { class: "boss" }, h("strong", {}, boss.name), h("span", {}, ` ${boss.text}`)),
    jokerRow(state, on),
    consumableRow(state, on),
    grid(state),
    h(
      "div",
      { class: "readout" },
      h("span", { class: "chips" }, String(last?.chips ?? 0)),
      h("span", { class: "times" }, "×"),
      h("span", { class: "mult" }, String(last?.mult ?? 1)),
    ),
    h("div", { class: "toast" }),
    keyboard(state, on),
  )
}

/* --------------------------------------------------------- the blind intro */

/**
 * The beat between the shop and the board. It exists for pacing — the player
 * arrives at a blind having decided what to buy, and this is where they read
 * what they are walking into before the keyboard demands anything of them.
 */
export function introView(state: RunState, on: Handlers, chrome: Chrome): HTMLElement {
  const boss = getBoss(state.blind.bossId)
  const name = BLIND_NAMES[state.blindIndex] ?? "Blind"

  return h(
    "div",
    { class: "screen center intro", onclick: () => on.play() },
    h("div", { class: "intro-ante" }, `Ante ${state.ante} of ${ANTES}`),
    h(
      "div",
      { class: `intro-card ${boss ? "boss-card" : ""}` },
      h("div", { class: "intro-name" }, boss ? boss.name : name),
      boss && h("div", { class: "intro-rule" }, boss.text),
      h("div", { class: "intro-label" }, "Score at least"),
      h("div", { class: "intro-target" }, String(state.blind.target)),
      h(
        "div",
        { class: "intro-meta" },
        `${state.blind.maxGuesses} guesses · reward ${money(BLIND_PAYOUT[state.blindIndex] ?? 0)}`,
      ),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.play() }, "Play"),
    muteButton(on, chrome),
  )
}

function muteButton(on: Handlers, chrome: Chrome): HTMLElement {
  return h(
    "button",
    {
      class: "mute",
      type: "button",
      // The card behind this is itself a tap target; without stopping here the
      // toggle would also start the blind.
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
    h("h1", { class: "banner win" }, "Blind cleared"),
    h(
      "div",
      { class: "panel" },
      h("div", { class: "answer-note" }, `The word was ${state.blind.answer.toUpperCase()}`),
      h("div", { class: "score-note" }, `${state.blind.score} of ${state.blind.target}`),
      reward && line(BLIND_NAMES[state.blindIndex] ?? "Blind", reward.base),
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

function shopItemCard(item: ShopItem, index: number, state: RunState, on: Handlers): HTMLElement {
  const affordable = state.gold >= item.cost

  let title = ""
  let text = ""
  let rarity = "common"

  if (item.kind === "joker") {
    const joker = JOKER_BY_ID.get(item.id)
    title = joker?.name ?? item.id
    text = joker?.text ?? ""
    rarity = joker?.rarity ?? "common"
  } else if (item.kind === "consumable") {
    const card = CONSUMABLE_BY_ID.get(item.id)
    title = card?.name ?? item.id
    text = card?.text ?? ""
  } else {
    title = `Etch ${item.letter.toUpperCase()}`
    text = `${item.letter.toUpperCase()} is worth +1 chip for the rest of the run`
  }

  return h(
    "button",
    {
      class: `shop-item rarity-${rarity} ${affordable ? "" : "broke"}`,
      type: "button",
      onclick: () => on.buy(index),
    },
    h("div", { class: "shop-item-name" }, title),
    h("div", { class: "shop-item-text" }, text),
    h("div", { class: "shop-item-cost" }, money(item.cost)),
  )
}

export function shopView(state: RunState, on: Handlers): HTMLElement {
  const shop = state.shop
  const reroll = shop ? rerollCost(shop) : 0

  const owned = state.jokers.map((instance, index) => {
    const joker = JOKER_BY_ID.get(instance.id)
    return h(
      "button",
      {
        class: `joker rarity-${joker?.rarity ?? "common"}`,
        type: "button",
        onclick: () => on.sell(index),
      },
      h("span", { class: "joker-name" }, joker?.name ?? instance.id),
      h("span", { class: "sell" }, `sell ${money(sellValue(joker?.cost ?? 4))}`),
    )
  })

  return h(
    "div",
    { class: "screen shop-screen" },
    h(
      "header",
      { class: "hud" },
      h("div", { class: "hud-blind" }, h("div", { class: "blind-name" }, "Shop")),
      h("div", { class: "hud-gold" }, money(state.gold)),
    ),
    h(
      "div",
      { class: "shop-items" },
      ...(shop?.items ?? []).map((item, index) =>
        item ? shopItemCard(item, index, state, on) : h("div", { class: "shop-item sold" }, "sold"),
      ),
    ),
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
        { class: "primary", type: "button", onclick: () => on.nextBlind() },
        "Next blind",
      ),
    ),
    h(
      "div",
      { class: "owned" },
      h(
        "div",
        { class: "owned-label" },
        `Jokers ${state.jokers.length}/${JOKER_SLOTS} · Cards ${state.consumables.length}/${CONSUMABLE_SLOTS} — tap a joker to sell`,
      ),
      h("div", { class: "jokers" }, ...owned),
    ),
    h("div", { class: "toast" }),
  )
}

/* ----------------------------------------------------------- run over */

export function endView(state: RunState, on: Handlers): HTMLElement {
  const won = state.phase === "victory"
  return h(
    "div",
    { class: "screen center" },
    h("h1", { class: `banner ${won ? "win" : "lose"}` }, won ? "Run complete" : "Run over"),
    h(
      "div",
      { class: "panel" },
      !won &&
        h("div", { class: "answer-note" }, `The word was ${state.blind.answer.toUpperCase()}`),
      !won &&
        h(
          "div",
          { class: "score-note" },
          `${state.blind.score} of ${state.blind.target} — short by ${state.blind.target - state.blind.score}`,
        ),
      h(
        "div",
        { class: "score-note" },
        `Reached ante ${state.ante}, ${BLIND_NAMES[state.blindIndex]}`,
      ),
    ),
    h("button", { class: "primary", type: "button", onclick: () => on.newRun() }, "New run"),
  )
}
