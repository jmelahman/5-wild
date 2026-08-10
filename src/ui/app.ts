import type { Action, GameEvent, RunState, WordSource } from "../engine"
import { reduce, startRun } from "../engine"
import { Sound } from "./audio"
import { clear, wait } from "./dom"
import type { Chrome, Handlers } from "./views"
import { blindView, endView, introView, rewardView, shopView } from "./views"

/** Bumping the suffix orphans every save in the wild — treat it as a migration. */
const SAVE_KEY = "5wild:run:v1"

/** Per-event pacing, in ms. Slow enough to read, fast enough to not be a cutscene. */
const PACE = { tile: 90, joker: 150, solve: 320, total: 400 }

/**
 * The tile turn. It runs longer than the gap between tiles on purpose, so the
 * reveals overlap into a cascade rather than a queue of separate flips.
 */
const FLIP = { total: 260, half: 130 }

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
  private readonly sound = new Sound()

  constructor(
    private readonly root: HTMLElement,
    private readonly words: WordSource,
    saved: RunState | null,
  ) {
    this.state = saved ?? startRun(rootSeed(), words).state
    this.bindPhysicalKeyboard()
  }

  start(): void {
    // A resumed run mid-blind goes straight back to the board — the player was
    // in the middle of a thought, and a card announcing the blind they are
    // already playing would be in the way.
    this.intro = this.state.phase === "blind" && this.state.blind.guesses.length === 0
    // Persist immediately: a fresh run is already a run, and closing the app
    // before the first keypress should not silently reroll the word.
    this.save()
    this.render()
  }

  /* ------------------------------------------------------------- dispatch */

  private dispatch(action: Action): void {
    if (this.busy) return
    const wasPhase = this.state.phase
    const { state, events } = reduce(this.state, action, this.words)

    const refusal = events.find((event) => event.type === "rejected")
    if (refusal) {
      this.toast(refusal.reason)
      return
    }

    this.state = state
    // Every arrival at a blind from elsewhere gets the intro card, which is the
    // only thing that makes the shop and the board feel like separate places.
    if (this.state.phase === "blind" && wasPhase !== "blind") this.intro = true
    this.save()

    if (events.some((event) => event.type === "gold")) this.sound.coin()

    const label = events.find((event) => event.type === "consumable")?.label
    this.render()
    if (label) this.toast(label)
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
      this.toast(refusal.reason)
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

    // The state was committed before any of this ran, so the HUD is already
    // showing the total the animation is about to build up to. Wind it back to
    // the pre-guess figure first, or the reveal spoils its own punchline.
    const scored = events.find((event) => event.type === "guess_scored")
    if (scoreEl && scored) scoreEl.textContent = String(scored.total - scored.score)

    for (const event of events) {
      switch (event.type) {
        case "tile": {
          this.reveal(tiles[event.index], event.index)
          readout(event.chips, event.mult)
          await this.pace(PACE.tile)
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
        case "solve_bonus": {
          if (event.factor > 1) {
            this.floater(screen, `solve ×${event.factor}`)
            screen.querySelector(".readout")?.classList.add("solved")
            this.sound.solve()
            await this.pace(PACE.solve)
          }
          break
        }
        case "guess_scored": {
          // The single most important number in the game, so it is the one
          // thing that animates its value rather than snapping to it.
          const from = event.total - event.score
          this.countUp(scoreEl, from, event.total)
          this.emphasise(screen, event.score / Math.max(1, this.state.blind.target))
          this.sound.score(event.score / Math.max(1, this.state.blind.target))
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

  /** Counts a number up on screen, snapping instantly if the player skipped. */
  private countUp(node: Element | null, from: number, to: number): void {
    if (!node) return
    if (this.skipping || reducedMotion() || from === to) {
      node.textContent = String(to)
      return
    }
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / COUNT_UP)
      // Ease out: most of the distance is covered early, so the number reads as
      // arriving rather than crawling.
      const eased = 1 - (1 - progress) ** 3
      node.textContent = String(Math.round(from + (to - from) * eased))
      if (progress < 1 && !this.skipping) requestAnimationFrame(tick)
      else node.textContent = String(to)
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
      this.dispatch({ type: "type_letter", letter })
    },
    enter: () => void this.submit(),
    back: () => this.dispatch({ type: "backspace" }),
    useConsumable: (index) => this.dispatch({ type: "use_consumable", index }),
    collect: () => this.dispatch({ type: "collect" }),
    buy: (index) => this.dispatch({ type: "buy", index }),
    sell: (index) => this.dispatch({ type: "sell_joker", index }),
    reroll: () => this.dispatch({ type: "reroll" }),
    nextBlind: () => this.dispatch({ type: "next_blind" }),
    newRun: () => {
      this.state = startRun(rootSeed(), this.words).state
      this.intro = true
      this.save()
      this.render()
    },
    inspect: (text) => this.toast(text),
    play: () => {
      this.intro = false
      this.render()
    },
    mute: () => {
      this.sound.toggleMute()
      this.render()
    },
  }

  private get chrome(): Chrome {
    return { muted: this.sound.isMuted }
  }

  /** `as` forces the blind board to stay on screen while its scoring plays out. */
  private render(as?: "blind"): void {
    const phase = as ?? this.state.phase
    const view =
      phase === "blind" && this.intro && !as
        ? introView(this.state, this.handlers, this.chrome)
        : phase === "reward"
          ? rewardView(this.state, this.handlers)
          : phase === "shop"
            ? shopView(this.state, this.handlers)
            : phase === "game_over" || phase === "victory"
              ? endView(this.state, this.handlers)
              : blindView(this.state, this.handlers)
    clear(this.root).append(view)
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
      if (this.state.phase !== "blind") return
      if (this.intro) {
        this.handlers.play()
        event.preventDefault()
        return
      }
      if (event.key === "Enter") void this.submit()
      else if (event.key === "Backspace") this.dispatch({ type: "backspace" })
      else if (/^[a-zA-Z]$/.test(event.key)) {
        this.sound.key()
        this.dispatch({ type: "type_letter", letter: event.key.toLowerCase() })
      } else return
      event.preventDefault()
    })
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
