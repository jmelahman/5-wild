import { clampAscension, MAX_ASCENSION } from "../engine"

/** Its own key, so a run save that goes bad cannot take the record with it. */
const META_KEY = "5wild:meta:v1"

/**
 * What outlives a run.
 *
 * A run is a closed world: it starts at ante 1 with four gold and ends when it
 * ends, and `RunState` is complete on its own. This is the other thing — the
 * player, across all of them. It lives in the UI layer for the same reason the
 * save does: `src/engine` must not know a browser exists. An ascension is an
 * *input* to `startRun`, and this is what remembers which one has been earned
 * and which one was last asked for.
 */
export type MetaState = {
  /** Runs started. Every "Play" is one, whether or not it went anywhere. */
  runs: number
  /** Runs that reached the win. */
  wins: number
  /** The deepest ante any run has stood on, including the endless ones. */
  bestAnte: number
  /**
   * The highest ascension a run has been won at, or -1 when none has.
   *
   * -1 rather than 0 because ascension 0 is the ordinary game, and "won it once"
   * has to be tellable from "never has" — that difference is the whole unlock.
   */
  cleared: number
  /**
   * The level last chosen on the title screen, which is where the next run
   * starts. Remembered rather than defaulted to the hardest unlocked one: a
   * player who has climbed to 4 and wants an easy evening should not have to
   * step down four times every launch to get one.
   */
  ascension: number
}

const FRESH: MetaState = { runs: 0, wins: 0, bestAnte: 0, cleared: -1, ascension: 0 }

/**
 * The hardest level on offer: one past the hardest ever won.
 *
 * Zero for a player who has never won, which is not a level at all — it is the
 * ordinary game, and the reason the selector stays off the title screen until
 * there is a second option to select.
 */
export const unlocked = (meta: MetaState): number => Math.min(MAX_ASCENSION, meta.cleared + 1)

/**
 * The level a new run would start at. Clamped on the way out rather than on the
 * way in, so a record carrying a level this build no longer offers — a shorter
 * ladder, a reset win — reads as the nearest legal one instead of refusing to
 * start a run at all.
 */
export const chosenAscension = (meta: MetaState): number =>
  Math.min(clampAscension(meta.ascension), unlocked(meta))

/**
 * The record, kept in memory and written through on every change.
 *
 * Reads happen on the title screen every render; writes happen a handful of
 * times a run. Holding the state here rather than re-reading the store keeps the
 * cheap thing cheap, and means a store that starts refusing writes mid-session
 * still shows the player a truthful number until they close the tab.
 */
export class Profile {
  private state: MetaState = loadMeta()

  get stats(): MetaState {
    return this.state
  }

  /** Called when a run actually begins, not when a `RunState` is constructed. */
  started(): void {
    this.write({ runs: this.state.runs + 1 })
  }

  /** The high-water mark. Idempotent, so it can be called on every save. */
  reached(ante: number): void {
    if (ante > this.state.bestAnte) this.write({ bestAnte: ante })
  }

  /** The level picked for the next run. Written straight through: it is a choice. */
  chose(ascension: number): void {
    if (ascension !== this.state.ascension) this.write({ ascension })
  }

  /** Banked at the offer, not at the ending: playing on cannot lose the win. */
  won(ascension: number): void {
    this.write({
      wins: this.state.wins + 1,
      cleared: Math.max(this.state.cleared, ascension),
    })
  }

  private write(change: Partial<MetaState>): void {
    this.state = { ...this.state, ...change }
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.state))
    } catch {
      // A full or blocked store costs the player their record, not their run.
    }
  }
}

/**
 * Read the record, field by field rather than all or nothing.
 *
 * `loadSave` throws a malformed run away whole, because half a run is not a run
 * anybody can play. This is the opposite kind of object: a handful of
 * independent counters, where one field arriving as garbage is no reason to
 * forget the rest. So each is taken if it is sane and defaulted if it is not,
 * and a build that adds a field later — as the ascension one was — reads older
 * records as zero on it rather than as absent.
 */
export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return { ...FRESH }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return { ...FRESH }
    const meta = parsed as Partial<Record<keyof MetaState, unknown>>
    return {
      runs: count(meta.runs),
      wins: count(meta.wins),
      bestAnte: count(meta.bestAnte),
      cleared: count(meta.cleared, -1),
      ascension: count(meta.ascension),
    }
  } catch {
    return { ...FRESH }
  }
}

/** A whole number that is not negative, or the default. Nothing here counts down. */
const count = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback
