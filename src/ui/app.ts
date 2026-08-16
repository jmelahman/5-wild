import type { Action, GameEvent, RunState, WordSource } from "../engine"
import { MULT_FOR_COLOR, reduce, startRun } from "../engine"
import { Sound } from "./audio"
import { clear, h, wait } from "./dom"
import { formatNumber as num } from "./format"
import { chosenAscension, Profile } from "./meta"
import type { Mood } from "./music"
import { Music } from "./music"
import type { Chrome, Handlers } from "./views"
import {
  ascendView,
  codexView,
  endView,
  fillCategory,
  fillReadout,
  helpView,
  introView,
  menuView,
  meterFill,
  packView,
  placeView,
  quitView,
  rewardView,
  roundView,
  shapesView,
  shopView,
  statsView,
  titleView,
  wordInPlay,
} from "./views"

/**
 * Bumping the suffix orphans every save in the wild — treat it as a migration.
 *
 * v2 because the vocabulary moved under it. A v1 save spells the same run
 * `ante`, `blindIndex`, `blind`, `jokers`, and `{type:"next_blind"}`; `loadSave`
 * would read it as a run missing half its fields and hand back something that
 * looks playable and is not. Renaming the key is how that save gets refused
 * cleanly rather than half-understood. It costs whoever was mid-run at the
 * upgrade exactly one run — the record survives, which is where the things worth
 * keeping live.
 */
const SAVE_KEY = "5wild:run:v2"

/** Set the first time the rules have been shown, so they only interrupt once. */
const HELP_KEY = "5wild:seen-help"

/** Set when the player has asked for a board with no numbers on it. */
const PLAIN_KEY = "5wild:plain"

/**
 * Per-event pacing, in ms. Slow enough to read, fast enough to not be a cutscene.
 *
 * `solve` is the outlier on purpose: it is the last beat before the reward screen
 * takes the board away, and it has to outlast `COUNT_UP` by enough that the pile's
 * new total is legible standing still rather than glimpsed mid-climb.
 */
const PACE = { tile: 170, relic: 150, solve: 900, total: 400 }

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

/** How long a tile's `+chips +mult` badge lives. Matches `gain-rise` in the CSS. */
const GAIN = 760

/**
 * A press long enough to mean "what is this" rather than "do this", and how far
 * a finger may drift before it is a scroll instead. Both are the platform
 * conventions: iOS fires its own long-press at 500ms and Android at 400, so
 * landing under both keeps this from arriving after the browser's own menu.
 */
const HOLD = 350
const HOLD_SLOP = 10

const reducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

export class App {
  private state: RunState
  /** True while a scoring animation owns the screen; input is ignored. */
  private busy = false
  /** Set when the player taps mid-animation: the rest of it plays instantly. */
  private skipping = false
  /** True while the round's intro card is up, before the board is dealt. */
  private intro = false
  /** True when there is no run to return to and the front door is showing. */
  private atTitle: boolean
  /** The modal on top of everything, if any. */
  private overlay: "help" | "codex" | "shapes" | "stats" | "menu" | "quit" | "ascend" | null = null
  /** Which rung the open lock is offering. Only meaningful while `overlay` is "ascend". */
  private ascendTo = 0
  /** The card or key whose tip is currently up, so re-entering it is not a change. */
  private hovered: HTMLElement | null = null
  /** True when the player has asked for the letters to stop shouting numbers. */
  private plain = plainBoard()
  private readonly sound = new Sound()
  private readonly music = new Music()
  /** The one thing here that outlives the run being played. */
  private readonly profile = new Profile()

  constructor(
    private readonly root: HTMLElement,
    private readonly words: WordSource,
    saved: RunState | null,
  ) {
    // A run is built either way so the rest of the class never has to deal with
    // a null state; it simply is not persisted until the player commits to it.
    this.state = saved ?? startRun(rootSeed(), words).state
    this.atTitle = saved === null
    // The class is on the document rather than in the render, so it has to be
    // put back on the way in — the stylesheet is the only thing that remembers.
    setPlainBoard(this.plain)
    this.bindPhysicalKeyboard()
    this.bindAudioWake()
    this.bindTips()
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
    return this.state.round.bossId ? "boss" : "round"
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
    // A resumed run mid-round goes straight back to the board — the player was
    // in the middle of a thought, and a card announcing the round they are
    // already playing would be in the way.
    this.intro = this.state.round.guesses.length === 0 && this.state.phase === "round"
    this.render()
  }

  /* ------------------------------------------------------------- dispatch */

  private dispatch(action: Action, typing?: "arriving" | "leaving"): void {
    if (this.busy) return
    const wasPhase = this.state.phase
    const before = this.state
    const { state, events } = reduce(this.state, action, this.words)

    const refusal = events.find((event) => event.type === "rejected")
    if (refusal) {
      this.refuse(refusal.reason)
      return
    }

    this.state = state
    this.tally(before)
    // Every arrival at a round from elsewhere gets the intro card, which is the
    // only thing that makes the shop and the board feel like separate places.
    if (this.state.phase === "round" && wasPhase !== "round") this.intro = true
    this.save()

    // The win is recorded where it is offered rather than where the run ends,
    // because those are no longer the same moment: a run can take the win and
    // then go looking for stage 20. The engine fires this once per run.
    //
    // The level comes off the run rather than off the record, so a win is banked
    // at the difficulty it was actually played at whatever has been chosen since.
    if (events.some((event) => event.type === "run_won")) {
      this.profile.won(this.state.ascension ?? 0)
    }

    const paid = events.some((event) => event.type === "gold")
    if (paid) this.sound.coin()

    // Both are a card leaving the player's hands and landing somewhere, and in
    // the shop there is no keyboard on screen to show where — so the toast is
    // the only confirmation that the Steel went on the E and not the R.
    const label =
      events.find((event) => event.type === "consumable")?.label ??
      events.find((event) => event.type === "mod_placed")?.label

    // A letter arriving or leaving is the one action that touches a single row
    // and nothing else on the screen, so it is the one action that patches
    // instead of re-rendering. Everything the guard checks is a reason the
    // screen might not be the board this assumes.
    const quiet = !paid && !label && !this.intro && !this.overlay && !this.atTitle
    if (typing && quiet && this.state.phase === "round" && this.patchDraft(typing)) return

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
    const round = this.state.round
    // `done` is the same condition the view uses to stop drawing a draft at all;
    // it cannot be reached by typing, but the two must not be allowed to disagree.
    if (round.done) return false
    const row = this.root.querySelector(`.grid .row[data-row="${round.guesses.length}"]`)
    if (!row || row.children.length !== round.answer.length) return false

    for (const [column, tile] of Array.from(row.children).entries()) {
      const typed = round.draft[column]
      const revealed = round.revealed[column]
      // Only the letter that just arrived lands. Backspace passes "leaving" and
      // nothing animates: a letter being taken away used to hand the animation
      // to the letter before it, which reads as the board twitching at a tile
      // the player did not touch.
      const lands = letter === "arriving" && column === round.draft.length - 1
      tile.className = typed
        ? `tile filled ${lands ? "land" : ""}`
        : revealed
          ? "tile ghost"
          : "tile"
      tile.textContent = (typed ?? revealed ?? "").toUpperCase()
    }
    // Two things outside the row change with a keystroke. The fifth letter is
    // what gives the word a shape, and naming it only after the guess was
    // submitted would be naming it one guess too late to be worth reading. The
    // readout moves on *every* letter, since every letter is worth chips.
    const slot = this.root.querySelector(".category-slot")
    if (slot) fillCategory(slot, this.state, this.handlers)
    const readout = this.root.querySelector(".readout")
    if (readout) fillReadout(readout, this.state)
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
    this.render("round")
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

    const row = screen.querySelector(`.row[data-row="${this.state.round.guesses.length - 1}"]`)
    const tiles = [...(row?.querySelectorAll(".tile") ?? [])]
    for (const tile of tiles) tile.classList.add("pending")
    // Held back the same way the colours are, and released with the last of
    // them: the boss's summary of a row is only meaningful after the row it
    // summarises has been seen, and it would otherwise be legible for the whole
    // length of the cascade it is the answer to.
    const note = row?.querySelector(".row-note")
    note?.classList.add("pending")

    const chipsEl = screen.querySelector(".readout .chips")
    const multEl = screen.querySelector(".readout .mult")
    const scoreEl = screen.querySelector(".hud .score")
    // The figures already on screen, so each step can react to the half that
    // moved rather than to both. Which half moved is the information: a gray
    // tile pays chips and nothing else, a green one pays both, and a player who
    // never sees the difference has to be told it in a tutorial instead.
    let shownChips = 0
    let shownMult = 1
    const readout = (chips: number, mult: number) => {
      if (chipsEl && chips !== shownChips) {
        chipsEl.textContent = num(chips)
        this.replay(chipsEl, "bumped", 320)
      }
      if (multEl && mult !== shownMult) {
        multEl.textContent = num(mult)
        this.replay(multEl, "bumped", 320)
      }
      shownChips = chips
      shownMult = mult
    }
    // Wound back for the same reason the total below it is: the board was drawn
    // after the guess was committed, so the readout starts out holding the
    // figure this is about to build up to.
    if (chipsEl) chipsEl.textContent = num(0)
    if (multEl) multEl.textContent = num(1)

    // The bar under the total is driven off the same numbers the count-up walks
    // through, so it fills in step with the digits instead of trailing them.
    const meterEl = screen.querySelector<HTMLElement>(".hud .meter-fill")
    const scoreBox = screen.querySelector(".hud-score")
    const target = this.state.round.target
    const meter = (value: number) => {
      meterEl?.style.setProperty("--fill", String(meterFill(value, target)))
      scoreBox?.classList.toggle("met", value >= target)
    }

    // The state was committed before any of this ran, so the HUD is already
    // showing the total the animation is about to build up to. Wind it back to
    // the pre-guess figure first, or the reveal spoils its own punchline.
    const scored = events.find((event) => event.type === "guess_scored")
    if (scoreEl && scored) scoreEl.textContent = num(scored.total - scored.score)
    /** The figure on screen, so the solve bonus knows what it is multiplying. */
    let onScreen = scored ? scored.total - scored.score : this.state.round.score
    meter(onScreen)

    for (const event of events) {
      switch (event.type) {
        case "tile": {
          const tile = tiles[event.index]
          this.reveal(tile, event.index)
          // Held until the turn is half done, which is when the colour appears.
          // Saying what the tile paid before showing what colour it came up
          // would answer the question in the wrong order.
          this.tileGain(tile, event.gained)
          if (event.index === tiles.length - 1) this.revealNote(note)
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
          this.sound.relic()
          readout(event.chips, event.mult)
          await this.pace(PACE.relic)
          tile?.classList.remove("fired")
          break
        }
        case "relic": {
          const slot = screen.querySelector(`.relic[data-slot="${event.slot}"]`)
          slot?.classList.add("fired")
          this.floater(screen, event.label)
          this.sound.relic()
          readout(event.chips, event.mult)
          await this.pace(PACE.relic)
          slot?.classList.remove("fired")
          break
        }
        case "category": {
          // Lights the line that was already naming this shape on the board, so
          // the label the player read before submitting is the thing that pays.
          const line = screen.querySelector(".category")
          line?.classList.add("fired")
          this.floater(screen, `${event.name} Lv ${event.level}`)
          this.sound.relic()
          readout(event.chips, event.mult)
          await this.pace(PACE.relic)
          line?.classList.remove("fired")
          break
        }
        case "relic_grew": {
          // Lands after the guess has finished scoring, because that is when it
          // happens: the round ended, and this card is worth more next time. No
          // readout — nothing about this guess's chips or mult moved, which is
          // exactly what distinguishes growing from firing.
          const slot = screen.querySelector(`.relic[data-slot="${event.slot}"]`)
          slot?.classList.add("fired")
          this.floater(screen, event.label)
          this.sound.relic()
          await this.pace(PACE.relic)
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
          this.emphasise(screen, event.total / Math.max(1, this.state.round.target))
          onScreen = event.total
          await this.pace(PACE.solve)
          break
        }
        case "guess_scored": {
          // The single most important number in the game, so it is the one
          // thing that animates its value rather than snapping to it.
          const from = event.total - event.score
          this.countUp(scoreEl, from, event.total, meter)
          this.emphasise(screen, event.score / Math.max(1, this.state.round.target))
          this.sound.score(event.score / Math.max(1, this.state.round.target))
          onScreen = event.total
          await this.pace(PACE.total)
          break
        }
        case "letter_destroyed":
          this.floater(screen, `${event.letter.toUpperCase()} burnt out`)
          this.sound.burn()
          await this.pace(PACE.relic)
          break
        default:
          break
      }
    }

    for (const tile of tiles) tile.classList.remove("pending")
    // Belt and braces: a guess that produced no tile events at all — or a skip
    // taken before the cascade reached the end — must not leave the note hidden
    // until the next full rebuild happens to drop it.
    note?.classList.remove("pending")
    screen.removeEventListener("pointerdown", onSkip)
  }

  /**
   * Lets the row's note in at the trough of the last tile's turn, which is the
   * moment that tile's colour appears. Same timing as `tileGain`, for the same
   * reason: the answer and the thing it is an answer to arrive together.
   */
  private revealNote(note: Element | null | undefined): void {
    if (!note) return
    if (this.skipping || reducedMotion()) {
      note.classList.remove("pending")
      return
    }
    setTimeout(() => note.classList.remove("pending"), FLIP.half)
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
   * What a tile just paid, said at the tile.
   *
   * Every other effect in the game announces itself — a relic lights up and
   * floats its number, a modifier lights the letter it rode in on — and the
   * tiles, which are where most of a guess actually comes from, said nothing.
   * The readout moved and the player was left to infer which of the five
   * letters had moved it.
   *
   * Both halves are named, and the chips half is named even when it is zero,
   * because a zero is the whole point under a boss that stops paying for
   * vowels. The mult half only appears when there is one: gray pays no
   * multiplier, and its silence next to a green tile's `+3 mult` is the clearest
   * statement of the rule this game has.
   *
   * The badge hangs off the row and is placed from the tile's own box, which is
   * the same lesson learned twice: a child of the tile would be scaled edge-on
   * by the very flip it is announcing, and a grid item — even one placed
   * explicitly into the tile's cell — perturbs the auto-placement of the five
   * tiles around it and wraps the row. Absolute, off measurements, disturbs
   * neither.
   */
  private tileGain(tile: Element | undefined, chips: number): void {
    const row = tile?.parentElement
    if (!(tile instanceof HTMLElement) || !row) return
    const color = ["green", "yellow", "gray"].find((name) => tile.classList.contains(name))
    const mult = MULT_FOR_COLOR[(color ?? "gray") as keyof typeof MULT_FOR_COLOR]

    const show = () => {
      const node = document.createElement("div")
      node.className = "tile-gain"
      node.style.left = `${tile.offsetLeft + tile.offsetWidth / 2}px`
      // Starts just inside the tile rather than above it, so it is unambiguously
      // this tile's number before it rises away over the row above.
      node.style.top = `${tile.offsetTop + tile.offsetHeight * 0.18}px`
      node.append(h("span", { class: "gain-chips" }, `+${chips}`))
      if (mult > 0) node.append(h("span", { class: "gain-mult" }, `+${mult}`))
      row.append(node)
      setTimeout(() => node.remove(), GAIN)
    }

    // Skipping runs the whole guess at once, so the badges would all land
    // together and then all expire together — five of them stacked on one row
    // is noise, not information. The player asked for the end; give them it.
    if (this.skipping) return
    if (reducedMotion()) show()
    else setTimeout(show, FLIP.half)
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
      node.textContent = num(to)
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
      node.textContent = num(value)
      also?.(value)
      if (progress < 1 && !this.skipping) requestAnimationFrame(tick)
      else {
        node.textContent = num(to)
        also?.(to)
      }
    }
    requestAnimationFrame(tick)
  }

  /**
   * Weight of the reaction, scaled by what the guess was worth against the
   * target. A chip guess twitches; a guess that clears the round on its own
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
    if (this.state.phase !== "round") return
    const row = this.root.querySelector(`.row[data-row="${this.state.round.guesses.length}"]`)
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

  /* ------------------------------------------------------------------ tips */

  /**
   * Read what a thing does without committing to it.
   *
   * Delegated from the root because the screen is thrown away and rebuilt on
   * every render, and keyed on `data-tip` rather than on the relic class,
   * because a letter needs the same panel as a card: the pips on a key say
   * `+3` and `?` and stop there, and the arithmetic behind them belongs
   * somewhere a player can reach mid-round.
   *
   * Hover is the desktop half. Touch gets `bindHeldTips`, because there is no
   * hovering a phone and because the keys — unlike the tray — do something when
   * you tap them.
   */
  private bindTips(): void {
    this.bindHeldTips()
    if (!window.matchMedia?.("(hover: hover)").matches) return
    this.root.addEventListener("pointerover", (event) => {
      const target = event.target
      const host = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null
      this.showTip(host)
    })
    // `pointerover` covers every move within the screen; this covers the one
    // move that fires nothing — straight out of the window.
    this.root.addEventListener("pointerleave", () => this.showTip(null))
  }

  /**
   * Press and hold, for the pointers that cannot hover.
   *
   * The hold has to swallow the tap that ends it, or asking what R is worth
   * types an R — which is the whole reason this is not simply "tap to show".
   * The click is caught in the capture phase at the root, which is upstream of
   * the button's own handler and so the only place that can stop it without the
   * key knowing anything about tips.
   *
   * Any movement cancels: a hold that has turned into a scroll is a scroll.
   */
  private bindHeldTips(): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let from: { x: number; y: number } | null = null
    /** Set by a hold that fired, and consumed by the click it belongs to. */
    let swallow = false

    const cancel = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      from = null
    }

    this.root.addEventListener("pointerdown", (event) => {
      this.showTip(null)
      // Cleared here rather than only where it is consumed: a hold whose click
      // never arrives — the browser swallowed it for a scroll — would otherwise
      // leave this armed and eat an unrelated tap later.
      swallow = false
      if (event.pointerType === "mouse") return
      const target = event.target
      const host = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null
      if (!host) return
      from = { x: event.clientX, y: event.clientY }
      timer = setTimeout(() => {
        swallow = true
        this.showTip(host)
      }, HOLD)
    })

    this.root.addEventListener("pointermove", (event) => {
      if (!from) return
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > HOLD_SLOP) cancel()
    })
    this.root.addEventListener("pointerup", cancel)
    this.root.addEventListener("pointercancel", cancel)

    this.root.addEventListener(
      "click",
      (event) => {
        if (!swallow) return
        swallow = false
        event.stopPropagation()
        event.preventDefault()
      },
      true,
    )
  }

  private showTip(host: HTMLElement | null): void {
    if (host === this.hovered) return
    this.hovered = host
    const tip = this.root.querySelector<HTMLElement>(".relic-tip")
    if (!tip) return
    if (!host) {
      tip.classList.remove("show")
      return
    }

    tip.textContent = host.dataset.tip ?? ""
    // Borrowing the card's rarity keeps the two reading as one object, which a
    // sibling of the tray cannot do by inheritance. A key has no rarity and
    // takes the common edge, which is the neutral one.
    tip.className = `relic-tip rarity-${host.dataset.rarity ?? "common"}`

    // Measured before it is shown, which `visibility: hidden` allows and
    // `display: none` would not: the height decides which side it goes on.
    const card = host.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const gap = 6
    const edge = 8
    // Below by preference — in a round the tray sits under the HUD with the
    // whole board beneath it. The shop keeps its relics at the foot of the
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
    sell: (index) => this.dispatch({ type: "sell_relic", index }),
    reroll: () => this.dispatch({ type: "reroll" }),
    nextRound: () => this.dispatch({ type: "next_round" }),
    continueRun: () => this.dispatch({ type: "continue_run" }),
    pickPack: (index) => this.dispatch({ type: "pick_pack", index }),
    skipPack: () => this.dispatch({ type: "skip_pack" }),
    placeMod: (letter) => {
      this.sound.key()
      this.dispatch({ type: "place_mod", letter })
    },
    newRun: () => {
      this.state = startRun(rootSeed(), this.words, chosenAscension(this.profile.stats)).state
      this.atTitle = false
      this.overlay = null
      this.intro = true
      // Counted here rather than in the constructor: the class always holds a
      // run so that nothing downstream has to handle a null one, and most of
      // those are scaffolding the player never sees.
      this.profile.started()
      // Persisted before the first keypress: a fresh run is already a run, and
      // closing the app on the intro card should not silently reroll the word.
      this.save()
      this.render()
    },
    // Kept on the record rather than in a field of this class, because it
    // outlives the session: the dial is where the player last left it, not where
    // this launch found it. `newRun` reads the same place, so there is one
    // answer to what level the next run starts at.
    setAscension: (level) => {
      this.profile.chose(level)
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
    togglePlain: () => {
      this.plain = !this.plain
      setPlainBoard(this.plain)
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
    openCodex: () => {
      this.overlay = "codex"
      this.render()
    },
    openShapes: () => {
      this.overlay = "shapes"
      this.render()
    },
    openStats: () => {
      this.overlay = "stats"
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
    // Mirrors askQuit/quit: the sheet is opened with the thing it is about, and
    // a second handler commits it. The level is held here rather than passed
    // back through the button because the sheet is rebuilt on every render and
    // the button that opened it is long gone by the time the answer arrives.
    askAscend: (level) => {
      this.ascendTo = level
      this.overlay = "ascend"
      this.render()
    },
    ascend: () => {
      this.profile.chose(this.ascendTo)
      this.overlay = null
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
    return { muted: this.sound.isMuted, musicOff: this.music.isOff, plain: this.plain }
  }

  /** `as` forces the round board to stay on screen while its scoring plays out. */
  private render(as?: "round"): void {
    const phase = as ?? this.state.phase
    this.music.set(this.mood)
    // The card the pointer was over is about to stop existing, and a stale node
    // here would read as "still hovering" and suppress the next tip.
    this.hovered = null
    const view = this.atTitle
      ? titleView(this.handlers, this.chrome, this.profile.stats)
      : phase === "round" && this.intro && !as
        ? introView(this.state, this.handlers, this.chrome)
        : phase === "reward"
          ? rewardView(this.state, this.handlers)
          : phase === "shop"
            ? shopView(this.state, this.handlers)
            : phase === "game_over" || phase === "victory"
              ? endView(this.state, this.handlers)
              : roundView(this.state, this.handlers, this.chrome)

    // Overlays sit beside the screen rather than replacing it, so the board is
    // still visible behind the sheet and the player keeps their bearings.
    //
    // A menu the player asked for outranks the open pack, so they can still quit
    // or read the rules mid-decision; the pack is waiting underneath when they
    // close it, because the engine will not let the shop move on until it is.
    const sheet =
      this.overlay === "help"
        ? helpView(this.handlers)
        : this.overlay === "codex"
          ? codexView(this.handlers)
          : this.overlay === "shapes"
            ? shapesView(this.state, this.handlers, phase === "round" ? wordInPlay(this.state) : "")
            : this.overlay === "stats"
              ? statsView(this.profile.stats, this.words.answers.length, this.handlers)
              : this.overlay === "menu"
                ? menuView(this.handlers, this.chrome)
                : this.overlay === "quit"
                  ? quitView(this.state, this.handlers)
                  : this.overlay === "ascend"
                    ? ascendView(this.ascendTo, this.handlers)
                    : // Both are held decisions the engine will not let the shop move
                      // past, and the two cannot be open at once — buying is refused
                      // while either is. Order is arbitrary; only exclusivity matters.
                      (placeView(this.state, this.handlers) ?? packView(this.state, this.handlers))

    clear(this.root).append(view)
    if (sheet) this.root.append(sheet)
    this.holdFocus()
  }

  /**
   * Put the keyboard inside the sheet, and keep it there.
   *
   * Called after every render rather than only on the one that opened the sheet,
   * because a render throws the whole screen away and builds a new one — the
   * focused node goes in the bin with it, and without this the tab order silently
   * resets to the top of the document behind the backdrop on every action.
   *
   * The sheet itself takes focus rather than its first button: a screen reader
   * then starts at the title and reads down, where landing on "Open the codex"
   * would announce the last thing in the sheet as though it were the point of it.
   *
   * Nothing is restored on close, and that is not an oversight — the element that
   * opened the sheet was destroyed by the render that opened it, so there is no
   * node left to hand focus back to. Focus falls to the body, which is where the
   * board wants it anyway: every key the game reads is bound to `window`.
   */
  private holdFocus(): void {
    const sheet = this.root.querySelector<HTMLElement>(".sheet")
    if (!sheet) return
    if (!sheet.contains(document.activeElement)) sheet.focus()
  }

  /* ----------------------------------------------------------------- save */

  /**
   * Everything the record learns from one action, read off the two states.
   *
   * Off the states rather than off the events, because none of these have an
   * event of their own and inventing four would be putting the profile's
   * questions into the engine's vocabulary. What the record wants to know —
   * which guess found the word, whether a relic is new to the tray — is a
   * difference between two runs, and both runs are right here.
   */
  private tally(before: RunState): void {
    const round = this.state.round
    // The round survives into the reward screen, so "same round, one more
    // guess" is a real comparison right up to the moment `next_round` swaps it.
    const played = round.guesses[before.round.guesses.length]
    if (played) this.profile.guessed(played.word)
    if (round.solved && !before.round.solved) {
      this.profile.solved(round.answer, round.guesses.length)
    } else if (round.done && !before.round.done) {
      this.profile.missed()
    }
    // A relic can arrive from the shop or out of a pack, and the tray is the one
    // place both routes end. Held ids rather than an index, because selling one
    // renumbers the rest.
    const held = new Set(before.relics.map((relic) => relic.id))
    for (const relic of this.state.relics) {
      if (!held.has(relic.id)) this.profile.took(relic.id)
    }
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state))
    } catch {
      // A full or disabled store costs the player their resume, not their run.
    }
    // Every moment the run is worth persisting is a moment its stage may have
    // moved, so the record rides along here rather than keeping its own watch.
    // It writes only when the mark actually moves.
    this.profile.reached(this.state.stage)
  }

  private bindPhysicalKeyboard(): void {
    // Desktop convenience during development; harmless on a phone.
    window.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Tab is the one key an open sheet does not swallow, and the reason this
      // check sits above the overlay branch rather than inside it: the pack and
      // the letter picker are modal too, and they are held by the engine rather
      // than by `overlay`. Everything wearing `.sheet` traps the same way.
      const sheet = this.root.querySelector<HTMLElement>(".sheet")
      if (sheet && event.key === "Tab") {
        trapTab(sheet, event)
        return
      }
      if (this.overlay) {
        // A sheet is modal, so it swallows everything and Escape dismisses it.
        if (event.key === "Escape") {
          this.handlers.closeOverlay()
          event.preventDefault()
          return
        }
        // Enter and Space are how a keyboard presses the button it has tabbed
        // to, and preventing them here is what made "Quit run" unreachable
        // without a mouse: the trap would walk focus onto it and neither key
        // would fire. So the swallow stops short of the two keys that are an
        // activation, and only when focus is inside the sheet — with focus
        // anywhere else Space is a page scroll behind the backdrop, which is
        // the thing modality is for.
        const focused = document.activeElement
        const pressing =
          (event.key === "Enter" || event.key === " ") &&
          focused instanceof HTMLElement &&
          focused.closest(".sheet") !== null
        if (!pressing) event.preventDefault()
        return
      }
      if (this.atTitle) return
      // A modifier in hand asks a letter question, and this is where letters
      // come from — the one thing outside a round a keypress can answer.
      if (this.state.placing && /^[a-zA-Z]$/.test(event.key)) {
        this.handlers.placeMod(event.key.toLowerCase())
        event.preventDefault()
        return
      }
      if (this.state.phase !== "round") return
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

/**
 * Everything in a sheet a Tab can land on, in the order Tab would visit it.
 *
 * Disabled buttons are excluded because the browser skips them anyway, and a
 * trap that thinks a disabled button is the last stop would wrap early — the
 * quit sheet and the shop both carry buttons that disable themselves.
 */
const focusableIn = (sheet: HTMLElement): HTMLElement[] => [
  ...sheet.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ),
]

/**
 * Keep Tab inside the open sheet.
 *
 * Without this, tabbing off the last button walks into the screen *behind* the
 * backdrop — buttons that are visible, pressable, and were supposed to be
 * unreachable until the sheet was dealt with. The wrap is the whole of what
 * makes a sheet modal to a keyboard rather than only to a mouse.
 */
function trapTab(sheet: HTMLElement, event: KeyboardEvent): void {
  const focusable = focusableIn(sheet)
  const active = document.activeElement
  if (focusable.length === 0) {
    // Nothing to move to, so the only correct move is not to move.
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  // Forward off the end, backward off the front, or adrift outside the sheet
  // entirely. Backward from the sheet itself counts as off the front: it holds
  // focus on the way in, and it sits before everything it contains.
  const leaving = event.shiftKey
    ? active === first || active === sheet || !sheet.contains(active)
    : active === last || !sheet.contains(active)
  if (!leaving) return
  event.preventDefault()
  ;(event.shiftKey ? last : first)?.focus()
}

function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // Nothing to do: the run is gone from memory either way.
  }
}

/**
 * Whether the per-letter marks are hidden, and the switch for it.
 *
 * A class on the root element rather than a flag threaded through the views,
 * for two reasons. The screen is rebuilt from scratch on every render, so
 * anything the views had to remember would have to be passed to all of them;
 * and what this hides is entirely presentational — a pip is still a pip, it is
 * just not being drawn — so the stylesheet is where the decision belongs. The
 * one class covers the keyboard, the board and any decoration added later,
 * without any of them being told the setting exists.
 */
function plainBoard(): boolean {
  try {
    return localStorage.getItem(PLAIN_KEY) === "1"
  } catch {
    return false
  }
}

function setPlainBoard(plain: boolean): void {
  document.documentElement.classList.toggle("plain", plain)
  try {
    localStorage.setItem(PLAIN_KEY, plain ? "1" : "0")
  } catch {
    // The setting lasts the session instead of the install. Nothing else breaks.
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
    return typeof state.seed === "number" && typeof state.phase === "string" && state.round
      ? state
      : null
  } catch {
    return null
  }
}

const rootSeed = (): number => Math.floor(Math.random() * 2 ** 31)
