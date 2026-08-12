import type { Action, GameEvent, RunState, WordSource } from "../engine"
import { reduce, startRun } from "../engine"
import { Sound } from "./audio"
import { clear, wait } from "./dom"
import type { Mood } from "./music"
import { Music } from "./music"
import type { Chrome, Handlers } from "./views"
import {
  blindView,
  endView,
  helpView,
  introView,
  menuView,
  meterFill,
  quitView,
  rewardView,
  shopView,
  titleView,
} from "./views"

/** Bumping the suffix orphans every save in the wild — treat it as a migration. */
const SAVE_KEY = "5wild:run:v1"

/** Set the first time the rules have been shown, so they only interrupt once. */
const HELP_KEY = "5wild:seen-help"

/**
 * Per-event pacing, in ms. Slow enough to read, fast enough to not be a cutscene.
 *
 * `solve` is the outlier on purpose: it is the last beat before the reward screen
 * takes the board away, and it has to outlast `COUNT_UP` by enough that the pile's
 * new total is legible standing still rather than glimpsed mid-climb.
 */
const PACE = { tile: 170, joker: 150, solve: 900, total: 400 }

/**
 * The tile turn. It runs longer than the gap between tiles on purpose, so the
 * reveals overlap into a cascade rather than a queue of separate flips.
 *
 * `total` must stay in step with the `.tile.flip` animation in the stylesheet —
 * CSS owns the motion, this owns when the class comes back off, and a mismatch
 * either clips the flip or leaves the tile stuck mid-turn.
 */
const FLIP = { total: 380, half: 190 }

/** How long the score counts up to its new value. */
const COUNT_UP = 340

const reducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

export class App {
  private state: RunState
  /** True while a scoring animation owns the screen; input is ignored. */
  private busy = false
  /** Set when the player taps mid-animation: the rest of it plays instantly. */
  private skipping = false
  /** True while the blind's intro card is up, before the board is dealt. */
  private intro = false
  /** True when there is no run to return to and the front door is showing. */
  private atTitle: boolean
  /** The modal on top of everything, if any. */
  private overlay: "help" | "menu" | "quit" | null = null
  /** The joker whose tip is currently up, so re-entering it is not a change. */
  private hovered: HTMLElement | null = null
  private readonly sound = new Sound()
  private readonly music = new Music()

  constructor(
    private readonly root: HTMLElement,
    private readonly words: WordSource,
    saved: RunState | null,
  ) {
    // A run is built either way so the rest of the class never has to deal with
    // a null state; it simply is not persisted until the player commits to it.
    this.state = saved ?? startRun(rootSeed(), words).state
    this.atTitle = saved === null
    this.bindPhysicalKeyboard()
    this.bindAudioWake()
    this.bindJokerTips()
  }

  /**
   * Audio may not start before the player has touched something, so the first
   * gesture of the session — whatever it was — is what starts the music. It also
   * stops on the way out: a phone that locks with the tab alive would otherwise
   * keep an oscillator running against the battery all night.
   */
  private bindAudioWake(): void {
    const wake = () => this.music.enable()
    document.addEventListener("pointerdown", wake, { once: true })
    document.addEventListener("keydown", wake, { once: true })
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.music.suspend()
      else this.music.resume()
    })
  }

  /** The mood follows the screen, so the shop and the boss do not share a tune. */
  private get mood(): Mood {
    if (this.atTitle) return "title"
    if (this.state.phase === "game_over" || this.state.phase === "victory") return "over"
    if (this.state.phase === "shop" || this.state.phase === "reward") return "shop"
    return this.state.blind.bossId ? "boss" : "blind"
  }

  start(): void {
    if (this.atTitle) {
      // First launch ever: lead with the rules rather than waiting to be asked.
      // Nothing about this game's scoring is guessable from a Wordle board.
      if (!seenHelp()) {
        this.overlay = "help"
        markHelpSeen()
      }
      this.render()
      return
    }
    // A resumed run mid-blind goes straight back to the board — the player was
    // in the middle of a thought, and a card announcing the blind they are
    // already playing would be in the way.
    this.intro = this.state.blind.guesses.length === 0 && this.state.phase === "blind"
    this.render()
  }

  /* ------------------------------------------------------------- dispatch */

  private dispatch(action: Action, typing?: "arriving" | "leaving"): void {
    if (this.busy) return
    const wasPhase = this.state.phase
    const { state, events } = reduce(this.state, action, this.words)

    const refusal = events.find((event) => event.type === "rejected")
    if (refusal) {
      this.refuse(refusal.reason)
      return
    }

    this.state = state
    // Every arrival at a blind from elsewhere gets the intro card, which is the
    // only thing that makes the shop and the board feel like separate places.
    if (this.state.phase === "blind" && wasPhase !== "blind") this.intro = true
    this.save()

    const paid = events.some((event) => event.type === "gold")
    if (paid) this.sound.coin()

    const label = events.find((event) => event.type === "consumable")?.label

    // A letter arriving or leaving is the one action that touches a single row
    // and nothing else on the screen, so it is the one action that patches
    // instead of re-rendering. Everything the guard checks is a reason the
    // screen might not be the board this assumes.
    const quiet = !paid && !label && !this.intro && !this.overlay && !this.atTitle
    if (typing && quiet && this.state.phase === "blind" && this.patchDraft(typing)) return

    this.render()
    // After the render, not before: the node the bump lands on is built by it.
    if (paid) this.bump(".hud-gold")
    if (label) this.toast(label)
  }

  /**
   * Redraw the row being typed, in place.
   *
   * The alternative — what this replaces — was a full render, which throws the
   * screen away and builds a new one. That is a lot of work to move one letter,
   * but the cost that shows is not the work: `.grid-wrap` is a size container and
   * `.grid` takes its width and its font-size from `cqh`/`cqw`. A container's size
   * is not known until it has been laid out, so a freshly-inserted grid has to be
   * styled twice — once against a container of unknown size, once against the
   * measured one. Both passes are meant to land in the same frame. Where they do
   * not, the first one resolves the fallback declarations, which are `width: 100%`
   * at `font-size: 1.25rem` — a board wider than the real one with letters at the
   * wrong size — and the second corrects it. Five times a word, that is a shake.
   *
   * Reported on Gecko, on a phone. The same build is steady in Chromium on the
   * desktop and in the Chromium WebView the APK runs in, and an earlier fix had
   * already ruled out the browser chrome (see the `svh` note in the stylesheet),
   * which leaves the engine's own timing as the thing that differs.
   *
   * Patching sidesteps the question rather than betting on the answer: the grid is
   * never rebuilt, so there is never a second pass to be late.
   *
   * Returns false if the board on screen is not the one this expects, leaving the
   * caller to fall back to a full render.
   */
  private patchDraft(letter: "arriving" | "leaving"): boolean {
    const blind = this.state.blind
    // `done` is the same condition the view uses to stop drawing a draft at all;
    // it cannot be reached by typing, but the two must not be allowed to disagree.
    if (blind.done) return false
    const row = this.root.querySelector(`.grid .row[data-row="${blind.guesses.length}"]`)
    if (!row || row.children.length !== blind.answer.length) return false

    for (const [column, tile] of Array.from(row.children).entries()) {
      const typed = blind.draft[column]
      const revealed = blind.revealed[column]
      // Only the letter that just arrived lands. Backspace passes "leaving" and
      // nothing animates: a letter being taken away used to hand the animation
      // to the letter before it, which reads as the board twitching at a tile
      // the player did not touch.
      const lands = letter === "arriving" && column === blind.draft.length - 1
      tile.className = typed
        ? `tile filled ${lands ? "land" : ""}`
        : revealed
          ? "tile ghost"
          : "tile"
      tile.textContent = (typed ?? revealed ?? "").toUpperCase()
    }
    return true
  }

  /**
   * Submitting is the one action with a story to tell, so it does not go
   * through `dispatch`: the board is drawn first, the event log is replayed
   * over it, and only then does the screen move on to the reward or the
   * game-over card.
   */
  private async submit(): Promise<void> {
    if (this.busy) return
    const { state, events } = reduce(this.state, { type: "submit" }, this.words)

    const refusal = events.find((event) => event.type === "rejected")
    if (refusal) {
      this.refuse(refusal.reason)
      return
    }

    this.state = state
    this.save()

    this.busy = true
    this.skipping = false
    this.render("blind")
    await this.animate(events)
    this.busy = false
    this.render()

    if (this.state.phase === "game_over") this.sound.lose()
    else if (this.state.phase === "reward" || this.state.phase === "victory") this.sound.win()
  }

  /* ------------------------------------------------------------ animation */

  private async animate(events: GameEvent[]): Promise<void> {
    const screen = this.root.firstElementChild
    if (!(screen instanceof HTMLElement)) return

    const onSkip = () => {
      this.skipping = true
    }
    screen.addEventListener("pointerdown", onSkip)

    const row = screen.querySelector(`.row[data-row="${this.state.blind.guesses.length - 1}"]`)
    const tiles = [...(row?.querySelectorAll(".tile") ?? [])]
    for (const tile of tiles) tile.classList.add("pending")

    const chipsEl = screen.querySelector(".readout .chips")
    const multEl = screen.querySelector(".readout .mult")
    const scoreEl = screen.querySelector(".hud .score")
    const readout = (chips: number, mult: number) => {
      if (chipsEl) chipsEl.textContent = String(chips)
      if (multEl) multEl.textContent = String(mult)
    }

    // The bar under the total is driven off the same numbers the count-up walks
    // through, so it fills in step with the digits instead of trailing them.
    const meterEl = screen.querySelector<HTMLElement>(".hud .meter-fill")
    const scoreBox = screen.querySelector(".hud-score")
    const target = this.state.blind.target
    const meter = (value: number) => {
      meterEl?.style.setProperty("--fill", String(meterFill(value, target)))
      scoreBox?.classList.toggle("met", value >= target)
    }

    // The state was committed before any of this ran, so the HUD is already
    // showing the total the animation is about to build up to. Wind it back to
    // the pre-guess figure first, or the reveal spoils its own punchline.
    const scored = events.find((event) => event.type === "guess_scored")
    if (scoreEl && scored) scoreEl.textContent = String(scored.total - scored.score)
    /** The figure on screen, so the solve bonus knows what it is multiplying. */
    let onScreen = scored ? scored.total - scored.score : this.state.blind.score
    meter(onScreen)

    for (const event of events) {
      switch (event.type) {
        case "tile": {
          this.reveal(tiles[event.index], event.index)
          readout(event.chips, event.mult)
          await this.pace(PACE.tile)
          break
        }
        case "mod": {
          // The tile itself lights up rather than a card in the tray: the thing
          // that fired is the letter, and it is already on screen.
          const tile = tiles[event.index]
          tile?.classList.add("fired")
          this.floater(screen, event.label)
          this.sound.joker()
          readout(event.chips, event.mult)
          await this.pace(PACE.joker)
          tile?.classList.remove("fired")
          break
        }
        case "joker": {
          const slot = screen.querySelector(`.joker[data-slot="${event.slot}"]`)
          slot?.classList.add("fired")
          this.floater(screen, event.label)
          this.sound.joker()
          readout(event.chips, event.mult)
          await this.pace(PACE.joker)
          slot?.classList.remove("fired")
          break
        }
        case "category": {
          // Lights the line that was already naming this shape on the board, so
          // the label the player read before submitting is the thing that pays.
          const line = screen.querySelector(".category")
          line?.classList.add("fired")
          this.floater(screen, `${event.name} Lv ${event.level}`)
          this.sound.joker()
          readout(event.chips, event.mult)
          await this.pace(PACE.joker)
          line?.classList.remove("fired")
          break
        }
        case "joker_grew": {
          // Lands after the guess has finished scoring, because that is when it
          // happens: the blind ended, and this card is worth more next time. No
          // readout — nothing about this guess's chips or mult moved, which is
          // exactly what distinguishes growing from firing.
          const slot = screen.querySelector(`.joker[data-slot="${event.slot}"]`)
          slot?.classList.add("fired")
          this.floater(screen, event.label)
          this.sound.joker()
          await this.pace(PACE.joker)
          slot?.classList.remove("fired")
          break
        }
        case "solve_bonus": {
          // Arrives after the guess has already been counted onto the total, so
          // this is the pile itself multiplying — the biggest number movement in
          // the game, and the one the whole round was building toward.
          this.floater(screen, `solve ×${event.factor}`)
          screen.querySelector(".readout")?.classList.add("solved")
          this.sound.solve()
          this.countUp(scoreEl, onScreen, event.total, meter)
          this.emphasise(screen, event.total / Math.max(1, this.state.blind.target))
          onScreen = event.total
          await this.pace(PACE.solve)
          break
        }
        case "guess_scored": {
          // The single most important number in the game, so it is the one
          // thing that animates its value rather than snapping to it.
          const from = event.total - event.score
          this.countUp(scoreEl, from, event.total, meter)
          this.emphasise(screen, event.score / Math.max(1, this.state.blind.target))
          this.sound.score(event.score / Math.max(1, this.state.blind.target))
          onScreen = event.total
          await this.pace(PACE.total)
          break
        }
        case "letter_destroyed":
          this.floater(screen, `${event.letter.toUpperCase()} burnt out`)
          this.sound.burn()
          await this.pace(PACE.joker)
          break
        default:
          break
      }
    }

    for (const tile of tiles) tile.classList.remove("pending")
    screen.removeEventListener("pointerdown", onSkip)
  }

  /**
   * Wordle's turn-over, done with a scale rather than a pair of stacked faces:
   * the colour is swapped at the trough, where the tile is edge-on and there is
   * nothing to see, which is the whole trick.
   */
  private reveal(tile: Element | undefined, index: number): void {
    if (!tile) return
    const color =
      ["green", "yellow", "gray"].find((name) => tile.classList.contains(name)) ?? "gray"
    this.sound.tile(index, color)

    if (this.skipping || reducedMotion()) {
      tile.classList.remove("pending")
      return
    }

    tile.classList.add("flip")
    // Timers rather than awaits: the flips are meant to overlap, so this one
    // must keep running while the next tile starts. Both are harmless if the
    // screen is replaced first — the node is simply detached by then.
    setTimeout(() => tile.classList.remove("pending"), FLIP.half)
    setTimeout(() => tile.classList.remove("flip"), FLIP.total)
  }

  /**
   * Counts a number up on screen, snapping instantly if the player skipped.
   *
   * `also` sees every intermediate value, so anything drawn from the same figure
   * — the progress bar — moves with the digits rather than after them.
   */
  private countUp(
    node: Element | null,
    from: number,
    to: number,
    also?: (value: number) => void,
  ): void {
    if (!node) return
    if (this.skipping || reducedMotion() || from === to) {
      node.textContent = String(to)
      also?.(to)
      return
    }
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / COUNT_UP)
      // Ease out: most of the distance is covered early, so the number reads as
      // arriving rather than crawling.
      const eased = 1 - (1 - progress) ** 3
      const value = Math.round(from + (to - from) * eased)
      node.textContent = String(value)
      also?.(value)
      if (progress < 1 && !this.skipping) requestAnimationFrame(tick)
      else {
        node.textContent = String(to)
        also?.(to)
      }
    }
    requestAnimationFrame(tick)
  }

  /**
   * Weight of the reaction, scaled by what the guess was worth against the
   * target. A chip guess twitches; a guess that clears the blind on its own
   * shakes the screen.
   */
  private emphasise(screen: HTMLElement, ratio: number): void {
    const readout = screen.querySelector(".readout")
    readout?.classList.remove("popped")
    void (readout as HTMLElement | null)?.offsetWidth
    if (readout instanceof HTMLElement) {
      readout.style.setProperty("--pop", String(1 + Math.min(0.5, ratio * 0.6)))
      readout.classList.add("popped")
    }
    if (ratio < 0.5 || reducedMotion()) return
    screen.style.setProperty("--shake", `${Math.min(8, 3 + ratio * 4).toFixed(1)}px`)
    screen.classList.add("shaking")
    setTimeout(() => screen.classList.remove("shaking"), 420)
  }

  private pace(ms: number): Promise<void> {
    return this.skipping ? Promise.resolve() : wait(ms)
  }

  private floater(screen: HTMLElement, text: string): void {
    const host = screen.querySelector(".readout")
    if (!host) return
    const node = document.createElement("div")
    node.className = "floater"
    node.textContent = text
    host.append(node)
    setTimeout(() => node.remove(), 900)
  }

  /**
   * A refusal, said twice: the toast gives the reason and the row moves.
   *
   * Wordle's shake is worth keeping because it answers the question a player
   * actually has — *which* of the things on screen was refused — in the half
   * second before they get round to reading the sentence.
   */
  private refuse(reason: string): void {
    this.toast(reason)
    if (this.state.phase !== "blind") return
    const row = this.root.querySelector(`.row[data-row="${this.state.blind.guesses.length}"]`)
    this.replay(row, "rejected", 420)
  }

  /** A one-shot class, restarted if it is already running. */
  private replay(node: Element | null, name: string, ms: number): void {
    if (!(node instanceof HTMLElement)) return
    node.classList.remove(name)
    // Forcing a reflow restarts the animation when two of these land in a row.
    void node.offsetWidth
    node.classList.add(name)
    setTimeout(() => node.classList.remove(name), ms)
  }

  private bump(selector: string): void {
    this.replay(this.root.querySelector(selector), "bumped", 320)
  }

  /* ------------------------------------------------------------ joker tips */

  /**
   * Hover a joker to read what it does.
   *
   * Delegated from the root because the screen is thrown away and rebuilt on
   * every render, and gated on the pointer being one that can hover at all: on
   * a phone the same text is already one tap away, and a panel chasing a finger
   * would cover the tray it is describing.
   */
  private bindJokerTips(): void {
    if (!window.matchMedia?.("(hover: hover)").matches) return
    this.root.addEventListener("pointerover", (event) => {
      const target = event.target
      const joker =
        target instanceof Element ? target.closest<HTMLElement>(".joker[data-tip]") : null
      this.showTip(joker)
    })
    // `pointerover` covers every move within the screen; this covers the one
    // move that fires nothing — straight out of the window.
    this.root.addEventListener("pointerleave", () => this.showTip(null))
  }

  private showTip(joker: HTMLElement | null): void {
    if (joker === this.hovered) return
    this.hovered = joker
    const tip = this.root.querySelector<HTMLElement>(".joker-tip")
    if (!tip) return
    if (!joker) {
      tip.classList.remove("show")
      return
    }

    tip.textContent = joker.dataset.tip ?? ""
    // Borrowing the card's rarity keeps the two reading as one object, which a
    // sibling of the tray cannot do by inheritance.
    tip.className = `joker-tip rarity-${joker.dataset.rarity ?? "common"}`

    // Measured before it is shown, which `visibility: hidden` allows and
    // `display: none` would not: the height decides which side it goes on.
    const card = joker.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const gap = 6
    const edge = 8
    // Below by preference — in a blind the tray sits under the HUD with the
    // whole board beneath it. The shop keeps its jokers at the foot of the
    // screen, and there this flips.
    const below = card.bottom + gap + box.height + edge <= window.innerHeight
    const centred = card.left + card.width / 2 - box.width / 2
    const left = Math.min(Math.max(edge, centred), window.innerWidth - box.width - edge)

    tip.style.setProperty("--slide", below ? "0.25rem" : "-0.25rem")
    tip.style.top = `${Math.round(below ? card.bottom + gap : card.top - gap - box.height)}px`
    tip.style.left = `${Math.round(left)}px`
    tip.classList.add("show")
  }

  private toast(message: string): void {
    const host = this.root.querySelector(".toast")
    if (!host) return
    host.textContent = message
    host.classList.remove("show")
    // Forcing a reflow restarts the animation when two refusals land in a row.
    void (host as HTMLElement).offsetWidth
    host.classList.add("show")
  }

  /* --------------------------------------------------------------- render */

  private readonly handlers: Handlers = {
    key: (letter) => {
      this.sound.key()
      this.dispatch({ type: "type_letter", letter }, "arriving")
    },
    enter: () => void this.submit(),
    back: () => this.dispatch({ type: "backspace" }, "leaving"),
    useConsumable: (index) => this.dispatch({ type: "use_consumable", index }),
    collect: () => this.dispatch({ type: "collect" }),
    buy: (index) => this.dispatch({ type: "buy", index }),
    sell: (index) => this.dispatch({ type: "sell_joker", index }),
    reroll: () => this.dispatch({ type: "reroll" }),
    nextBlind: () => this.dispatch({ type: "next_blind" }),
    newRun: () => {
      this.state = startRun(rootSeed(), this.words).state
      this.atTitle = false
      this.overlay = null
      this.intro = true
      // Persisted before the first keypress: a fresh run is already a run, and
      // closing the app on the intro card should not silently reroll the word.
      this.save()
      this.render()
    },
    inspect: (text) => this.toast(text),
    play: () => {
      this.intro = false
      this.render()
    },
    mute: () => {
      // The effects switch carries the music with it when it silences the game,
      // because a player reaching for it wants quiet, not a quieter mix. Turning
      // sound back on only revives music that was not switched off on its own.
      const muted = this.sound.toggleMute()
      if (muted) this.music.suspend()
      else this.music.resume()
      this.render()
    },
    toggleMusic: () => {
      this.music.toggle()
      this.render()
    },
    openMenu: () => {
      // Mid-animation the screen belongs to the scoring; the button is on the
      // HUD the whole time, so this is a reachable tap rather than a theory.
      if (this.busy) return
      this.overlay = "menu"
      this.render()
    },
    openHelp: () => {
      this.overlay = "help"
      markHelpSeen()
      this.render()
    },
    closeOverlay: () => {
      this.overlay = null
      this.render()
    },
    askQuit: () => {
      this.overlay = "quit"
      this.render()
    },
    quit: () => {
      clearSave()
      // Back to a run nobody is playing, purely so `state` stays non-null. The
      // player gets one at the title screen when they ask for it.
      this.state = startRun(rootSeed(), this.words).state
      this.atTitle = true
      this.overlay = null
      this.intro = false
      this.render()
    },
  }

  private get chrome(): Chrome {
    return { muted: this.sound.isMuted, musicOff: this.music.isOff }
  }

  /** `as` forces the blind board to stay on screen while its scoring plays out. */
  private render(as?: "blind"): void {
    const phase = as ?? this.state.phase
    this.music.set(this.mood)
    // The card the pointer was over is about to stop existing, and a stale node
    // here would read as "still hovering" and suppress the next tip.
    this.hovered = null
    const view = this.atTitle
      ? titleView(this.handlers, this.chrome)
      : phase === "blind" && this.intro && !as
        ? introView(this.state, this.handlers, this.chrome)
        : phase === "reward"
          ? rewardView(this.state, this.handlers)
          : phase === "shop"
            ? shopView(this.state, this.handlers)
            : phase === "game_over" || phase === "victory"
              ? endView(this.state, this.handlers)
              : blindView(this.state, this.handlers)

    // Overlays sit beside the screen rather than replacing it, so the board is
    // still visible behind the sheet and the player keeps their bearings.
    const sheet =
      this.overlay === "help"
        ? helpView(this.handlers)
        : this.overlay === "menu"
          ? menuView(this.handlers, this.chrome)
          : this.overlay === "quit"
            ? quitView(this.state, this.handlers)
            : null

    clear(this.root).append(view)
    if (sheet) this.root.append(sheet)
  }

  /* ----------------------------------------------------------------- save */

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state))
    } catch {
      // A full or disabled store costs the player their resume, not their run.
    }
  }

  private bindPhysicalKeyboard(): void {
    // Desktop convenience during development; harmless on a phone.
    window.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (this.overlay) {
        // A sheet is modal, so it swallows everything and Escape dismisses it.
        if (event.key === "Escape") this.handlers.closeOverlay()
        event.preventDefault()
        return
      }
      if (this.atTitle) return
      if (this.state.phase !== "blind") return
      if (this.intro) {
        this.handlers.play()
        event.preventDefault()
        return
      }
      // Through the handlers rather than straight to `dispatch`, so a typed
      // letter takes the same path whichever keyboard it came from.
      if (event.key === "Enter") void this.submit()
      else if (event.key === "Backspace") this.handlers.back()
      else if (/^[a-zA-Z]$/.test(event.key)) this.handlers.key(event.key.toLowerCase())
      else return
      event.preventDefault()
    })
  }
}

function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // Nothing to do: the run is gone from memory either way.
  }
}

function seenHelp(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === "1"
  } catch {
    // A blocked store means the rules show every launch, which is the safe way
    // to be wrong about it.
    return false
  }
}

function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_KEY, "1")
  } catch {
    // See above.
  }
}

export function loadSave(): RunState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    // Just enough of a shape check to survive a save from an older build.
    if (typeof parsed !== "object" || parsed === null) return null
    const state = parsed as RunState
    return typeof state.seed === "number" && typeof state.phase === "string" && state.blind
      ? state
      : null
  } catch {
    return null
  }
}

const rootSeed = (): number => Math.floor(Math.random() * 2 ** 31)
