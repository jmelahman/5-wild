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
  /** Guesses submitted, ever. The denominator the word tally is read against. */
  guesses: number
  /**
   * Blinds whose answer was found, counted by which guess found it — so
   * `solves[4]` is "cracked it on the fourth". Index 0 is always zero and index
   * 1 is the lucky ones; the array is indexed by guess number rather than by
   * `n - 1` so that a glance at the stored JSON reads straight.
   */
  solves: number[]
  /** Blinds that ended with the answer still hidden, won on score or lost. */
  missed: number
  /**
   * Every distinct answer ever cracked, sorted.
   *
   * The one growing field, and the only one that earns it: it is bounded by the
   * answer list rather than by play, so a player who cracked every word in the
   * game has a 2,300-entry array and no way to make it longer. It is also the
   * one collection this game has — "which words have I beaten" is a question
   * worth a screen, and it cannot be answered by a counter.
   */
  cracked: string[]
  /**
   * How often the most-played words have been played. Capped — see `tally`.
   */
  words: Record<string, number>
  /** How often each joker has been taken. Bounded by the catalogue. */
  jokers: Record<string, number>
}

const FRESH: MetaState = {
  runs: 0,
  wins: 0,
  bestAnte: 0,
  cleared: -1,
  ascension: 0,
  guesses: 0,
  solves: [],
  missed: 0,
  cracked: [],
  words: {},
  jokers: {},
}

/**
 * How many words the tally keeps counts for.
 *
 * Small on purpose. The alternative — a count for every word ever typed — tops
 * out near sixteen thousand entries, grows with play rather than with content,
 * and is rewritten on every guess. This is the one field on the hot path, so it
 * is the one field that is not allowed to grow.
 */
const WORD_SLOTS = 24

/** The most guesses a blind could ever take, as a ceiling on `solves`. */
const GUESS_CAP = 12

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

/** Blinds that reached an ending, which is what the breakdown is a breakdown of. */
export const blindsPlayed = (meta: MetaState): number =>
  meta.missed + meta.solves.reduce((sum, count) => sum + count, 0)

/**
 * The word played most, and how often — or null before anything has been.
 *
 * The count is exact for any word that was in the tally before it filled up,
 * which is every word a player types habitually. A word that arrived after the
 * cap was reached inherits the count of whatever it displaced, so it can read
 * high; that is the price of a fixed-size table, and it is paid by words nobody
 * would call their favourite.
 */
export function favouriteWord(meta: MetaState): { word: string; count: number } | null {
  let best: { word: string; count: number } | null = null
  for (const [word, count] of Object.entries(meta.words)) {
    // Ties break alphabetically rather than by insertion order, so the answer
    // does not depend on the order `Object.entries` happens to hand things back.
    if (!best || count > best.count || (count === best.count && word < best.word)) {
      best = { word, count }
    }
  }
  return best
}

/** Jokers by how often they have been taken, most-taken first. */
export const favouriteJokers = (meta: MetaState): { id: string; count: number }[] =>
  Object.entries(meta.jokers)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))

/**
 * Bump a word's count, in a table that is not allowed to outgrow `WORD_SLOTS`.
 *
 * This is Space-Saving: a newcomer arriving at a full table evicts the weakest
 * entry and *inherits its count* rather than starting from one. Which sounds
 * like cheating, and is exactly what makes the table trustworthy — a word can
 * only be pushed out by something at least as common, so anything played more
 * than one part in `WORD_SLOTS` of the time is guaranteed to still be here. The
 * question the screen asks is "what do I play most", and this answers it
 * correctly while a naive top-24 — which would freeze on the first 24 words
 * ever typed, since a newcomer's count of 1 never beats an incumbent's — would
 * not.
 */
function tally(words: Readonly<Record<string, number>>, word: string): Record<string, number> {
  const next = { ...words }
  const seen = next[word]
  if (seen !== undefined) {
    next[word] = seen + 1
    return next
  }
  const keys = Object.keys(next)
  if (keys.length < WORD_SLOTS) {
    next[word] = 1
    return next
  }
  let weakest = keys[0] as string
  for (const key of keys) if ((next[key] ?? 0) < (next[weakest] ?? 0)) weakest = key
  const floor = next[weakest] ?? 0
  delete next[weakest]
  next[word] = floor + 1
  return next
}

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

  /** One submitted guess. The hot path: every keystroke run ends here. */
  guessed(word: string): void {
    this.write({ guesses: this.state.guesses + 1, words: tally(this.state.words, word) })
  }

  /**
   * A blind's answer found, on the `guesses`th try.
   *
   * The word goes in the collection whether or not the blind was then won on
   * score — cracking it is the thing being remembered, and a player who found
   * the word and still fell short of the target found the word.
   */
  solved(answer: string, guesses: number): void {
    const at = Math.min(Math.max(1, Math.round(guesses)), GUESS_CAP)
    const solves = [...this.state.solves]
    while (solves.length <= at) solves.push(0)
    solves[at] = (solves[at] ?? 0) + 1
    const known = this.state.cracked.includes(answer)
    this.write({
      solves,
      ...(known ? {} : { cracked: [...this.state.cracked, answer].sort() }),
    })
  }

  /** A blind that ended with the answer never found. */
  missed(): void {
    this.write({ missed: this.state.missed + 1 })
  }

  /** A joker joining the tray, however it got there. */
  took(id: string): void {
    this.write({ jokers: { ...this.state.jokers, [id]: (this.state.jokers[id] ?? 0) + 1 } })
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
      guesses: count(meta.guesses),
      solves: counts(meta.solves).slice(0, GUESS_CAP + 1),
      missed: count(meta.missed),
      cracked: collection(meta.cracked),
      words: table(meta.words, WORD_SLOTS),
      jokers: table(meta.jokers),
    }
  } catch {
    return { ...FRESH }
  }
}

/** A whole number that is not negative, or the default. Nothing here counts down. */
const count = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback

/** A row of counters. A bad cell reads as zero rather than voiding the row. */
const counts = (value: unknown): number[] =>
  Array.isArray(value) ? value.map((cell) => count(cell)) : []

/**
 * A map of counters, trimmed to `slots` by taking the largest.
 *
 * The trim is what stops a record hand-edited or written by a build with a
 * bigger cap from reintroducing the unbounded map this was built to avoid.
 * Nothing is trimmed when `slots` is left off, which is right for the joker
 * map: it is bounded by the catalogue, and a joker retired from the game should
 * still be able to say it was somebody's favourite.
 */
function table(value: unknown, slots?: number): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const kept = Object.entries(value as Record<string, unknown>)
    .filter(([, cell]) => count(cell) > 0)
    .sort((a, b) => count(b[1]) - count(a[1]))
    .slice(0, slots ?? Infinity)
  return Object.fromEntries(kept.map(([key, cell]) => [key, count(cell)]))
}

/**
 * The distinct words cracked. Deduped and sorted on the way in, because the
 * screen counts them and `solved` assumes what it reads back is a set.
 */
const collection = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((word): word is string => typeof word === "string"))].sort()
    : []
