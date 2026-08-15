import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MAX_ASCENSION } from "../../src/engine"
import type { MetaState } from "../../src/ui/meta"
import {
  blindsPlayed,
  chosenAscension,
  favouriteJokers,
  favouriteWord,
  isLocked,
  loadMeta,
  Profile,
  unlocked,
} from "../../src/ui/meta"

const KEY = "5wild:meta:v2"

/**
 * A store, standing in for the browser's.
 *
 * The tests run in node, where there is no `localStorage` to lean on, and the
 * point of this module is what it does with one — including what it does with
 * one that has stopped cooperating, which no real store will do on demand.
 */
class FakeStorage {
  readonly items = new Map<string, string>()
  /** Set to make every write throw, the way a full or blocked store does. */
  sealed = false

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.sealed) throw new Error("QuotaExceededError")
    this.items.set(key, value)
  }
}

let store: FakeStorage

const stored = (): unknown => JSON.parse(store.items.get(KEY) ?? "null")

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

beforeEach(() => {
  store = new FakeStorage()
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage")
})

describe("reading the record", () => {
  it("starts everyone at nothing, with no win to their name", () => {
    expect(loadMeta()).toEqual(FRESH)
  })

  it("reads back what was written", () => {
    const record: MetaState = {
      runs: 12,
      wins: 2,
      bestAnte: 14,
      cleared: 1,
      ascension: 2,
      guesses: 431,
      solves: [0, 1, 4, 19, 22, 9],
      missed: 7,
      cracked: ["crane", "slate"],
      words: { crane: 88, slate: 12 },
      jokers: { snowball: 3 },
    }
    store.items.set(KEY, JSON.stringify(record))
    expect(loadMeta()).toEqual(record)
  })

  it("keeps the fields it can read when one of them is garbage", () => {
    // The opposite of `loadSave`, which throws a bad run away whole. Independent
    // counters: a broken one is no reason to forget the rest.
    store.items.set(KEY, JSON.stringify({ runs: 9, wins: "lots", bestAnte: 6.5, cleared: null }))
    expect(loadMeta()).toEqual({ ...FRESH, runs: 9 })
  })

  it("survives anything at all under its key", () => {
    for (const raw of ["", "not json", "null", "7", '"a string"', "[]"]) {
      store.items.set(KEY, raw)
      expect(loadMeta(), raw).toEqual(FRESH)
    }
  })

  it("reads a record written before a field existed as zero on it", () => {
    // Which is what every record in the wild looks like to the build that added
    // the ascension to it: a player mid-career, at the bottom of a new ladder.
    store.items.set(KEY, JSON.stringify({ runs: 3, wins: 1, bestAnte: 8, cleared: 0 }))
    expect(loadMeta()).toEqual({ ...FRESH, runs: 3, wins: 1, bestAnte: 8, cleared: 0 })
  })
})

describe("keeping the record", () => {
  it("counts runs as they are started", () => {
    const profile = new Profile()
    profile.started()
    profile.started()
    expect(profile.stats.runs).toBe(2)
    expect(stored()).toMatchObject({ runs: 2 })
  })

  it("keeps the deepest ante and ignores the shallower ones", () => {
    const profile = new Profile()
    profile.reached(1)
    profile.reached(7)
    profile.reached(3)
    expect(profile.stats.bestAnte).toBe(7)
  })

  it("does not touch the store when the mark has not moved", () => {
    const profile = new Profile()
    profile.reached(5)
    store.items.delete(KEY)
    // Called on every save, which is every action of every run. A write per
    // keystroke would be the whole cost of the feature.
    profile.reached(4)
    profile.reached(5)
    expect(store.items.has(KEY)).toBe(false)
  })

  it("records the win and the level it was won at", () => {
    const profile = new Profile()
    profile.won(0)
    expect(profile.stats).toMatchObject({ wins: 1, cleared: 0 })
    // A second win at an easier level is still a win, but it does not un-clear
    // the harder one — `cleared` is a high-water mark, not a last-seen.
    profile.won(3)
    profile.won(1)
    expect(profile.stats).toMatchObject({ wins: 3, cleared: 3 })
  })

  it("picks up where the last session left off", () => {
    const first = new Profile()
    first.started()
    first.reached(9)
    first.won(0)
    expect(new Profile().stats).toEqual(first.stats)
  })

  it("remembers the level that was chosen, and writes nothing when it has not moved", () => {
    const profile = new Profile()
    profile.chose(3)
    expect(profile.stats.ascension).toBe(3)
    store.items.delete(KEY)
    profile.chose(3)
    expect(store.items.has(KEY)).toBe(false)
  })

  it("keeps counting for the session when the store stops taking writes", () => {
    const profile = new Profile()
    profile.started()
    store.sealed = true
    profile.started()
    // The number on screen stays true even though nothing will remember it.
    expect(profile.stats.runs).toBe(2)
    expect(stored()).toMatchObject({ runs: 1 })
  })
})

describe("what the ladder offers", () => {
  const meta = (change: Partial<MetaState>): MetaState => ({ ...FRESH, ...change })

  it("has earned nothing until the game has been won once", () => {
    // The dial is still on the title screen — every rung is reachable — but
    // nothing above the ordinary game has been climbed to yet.
    expect(unlocked(FRESH)).toBe(0)
    expect(chosenAscension(FRESH)).toBe(0)
  })

  it("earns exactly one rung above the hardest ever won", () => {
    expect(unlocked(meta({ cleared: 0 }))).toBe(1)
    expect(unlocked(meta({ cleared: 3 }))).toBe(4)
  })

  it("stops at the top of the ladder", () => {
    expect(unlocked(meta({ cleared: MAX_ASCENSION }))).toBe(MAX_ASCENSION)
  })

  it("starts a run where the dial was left", () => {
    expect(chosenAscension(meta({ cleared: 4, ascension: 2 }))).toBe(2)
  })

  it("lets a run start above anything ever won", () => {
    // The warning under the dial is the whole of the gate. A player who dialled
    // past their record gets the run they asked for, not the one they earned.
    expect(chosenAscension(meta({ cleared: 0, ascension: 5 }))).toBe(5)
    expect(chosenAscension(meta({ cleared: -1, ascension: 3 }))).toBe(3)
  })

  it("hands back a level the ladder does not have", () => {
    // A record can outlive the ladder it was written against. Reading it as the
    // nearest legal level is what stops that record from being an unstartable run.
    expect(chosenAscension(meta({ cleared: 999, ascension: 999 }))).toBe(MAX_ASCENSION)
    expect(chosenAscension(meta({ ascension: -4 }))).toBe(0)
  })

  it("locks every level above the hardest earned, and nothing at or below it", () => {
    const fresh = meta({ cleared: -1 })
    expect(isLocked(fresh, 0)).toBe(false)
    expect(isLocked(fresh, 1)).toBe(true)

    const won = meta({ cleared: 2 })
    expect(isLocked(won, 3)).toBe(false)
    expect(isLocked(won, 4)).toBe(true)
  })
})

describe("what the runs added up to", () => {
  it("counts every guess and remembers which words they were", () => {
    const profile = new Profile()
    for (const word of ["crane", "slate", "crane"]) profile.guessed(word)
    expect(profile.stats.guesses).toBe(3)
    expect(profile.stats.words).toEqual({ crane: 2, slate: 1 })
    expect(favouriteWord(profile.stats)).toEqual({ word: "crane", count: 2 })
  })

  it("has no favourite before anything has been played", () => {
    expect(favouriteWord(loadMeta())).toBeNull()
  })

  it("never lets the word table outgrow its cap", () => {
    const profile = new Profile()
    // Far more distinct words than there are slots, each played once. A table
    // that grew with play would now hold two hundred entries and a save that
    // gets slower every session.
    for (let n = 0; n < 200; n++) profile.guessed(`w${n.toString().padStart(4, "0")}`)
    expect(Object.keys(profile.stats.words).length).toBeLessThanOrEqual(24)
    expect(profile.stats.guesses).toBe(200)
  })

  it("finds the real favourite even when it started late", () => {
    // The failure a naive top-N has: fill the table with one-offs first, so a
    // newcomer's count of 1 can never beat an incumbent's, and the table freezes
    // on the first words ever typed. Space-Saving lets the newcomer in.
    const profile = new Profile()
    for (let n = 0; n < 60; n++) profile.guessed(`w${n.toString().padStart(4, "0")}`)
    for (let n = 0; n < 40; n++) profile.guessed("crane")
    expect(favouriteWord(profile.stats)?.word).toBe("crane")
  })

  it("breaks a tie the same way twice", () => {
    const profile = new Profile()
    profile.guessed("slate")
    profile.guessed("crane")
    // Alphabetical, not whichever key `Object.entries` happens to hand back
    // first — the screen should not change its mind between renders.
    expect(favouriteWord(profile.stats)?.word).toBe("crane")
  })

  it("counts a solve under the guess that found it", () => {
    const profile = new Profile()
    profile.solved("crane", 4)
    profile.solved("slate", 4)
    profile.solved("mound", 2)
    expect(profile.stats.solves).toEqual([0, 0, 1, 0, 2])
    expect(blindsPlayed(profile.stats)).toBe(3)
  })

  it("collects each answer once, however often it comes up", () => {
    const profile = new Profile()
    profile.solved("crane", 3)
    profile.solved("crane", 5)
    profile.solved("adobe", 4)
    // Sorted, so the array is a set with an order and the screen can show it.
    expect(profile.stats.cracked).toEqual(["adobe", "crane"])
  })

  it("counts a blind that ran out of guesses", () => {
    const profile = new Profile()
    profile.solved("crane", 3)
    profile.missed()
    expect(blindsPlayed(profile.stats)).toBe(2)
    expect(profile.stats.cracked).toEqual(["crane"])
  })

  it("keeps a wild guess count inside the row it has", () => {
    const profile = new Profile()
    profile.solved("crane", 0)
    profile.solved("slate", 99)
    // Nothing is solved on guess zero, and no blind runs to ninety-nine. Both
    // are clamped rather than trusted, because this array is indexed with them.
    expect(profile.stats.solves.length).toBeLessThanOrEqual(13)
    expect(profile.stats.solves[1]).toBe(1)
    expect(profile.stats.solves[12]).toBe(1)
  })

  it("ranks the jokers by how often they were taken", () => {
    const profile = new Profile()
    for (const id of ["snowball", "banker", "snowball", "banker", "snowball"]) profile.took(id)
    expect(favouriteJokers(profile.stats)).toEqual([
      { id: "snowball", count: 3 },
      { id: "banker", count: 2 },
    ])
  })
})

describe("salvaging the longer record", () => {
  it("reads a record written before the statistics existed", () => {
    // Every record in the wild, to the build that adds them: a player mid-career
    // whose history starts today.
    store.items.set(KEY, JSON.stringify({ runs: 40, wins: 3, bestAnte: 9, cleared: 2 }))
    expect(loadMeta()).toEqual({ ...FRESH, runs: 40, wins: 3, bestAnte: 9, cleared: 2 })
  })

  it("drops the cells it cannot read and keeps the row", () => {
    store.items.set(
      KEY,
      JSON.stringify({ solves: [0, "two", 3.5, 4], cracked: ["crane", 7, "crane"], words: "no" }),
    )
    expect(loadMeta()).toMatchObject({
      solves: [0, 0, 0, 4],
      cracked: ["crane"],
      words: {},
    })
  })

  it("trims a word table that arrives too big for its slots", () => {
    // A hand-edited record, or one from a build with a bigger cap. Trimmed to
    // the largest, so the field cannot be talked back into growing forever.
    const bloated = Object.fromEntries(
      Array.from({ length: 90 }, (_, n) => [`w${n.toString().padStart(4, "0")}`, n + 1]),
    )
    store.items.set(KEY, JSON.stringify({ words: bloated, jokers: bloated }))
    const meta = loadMeta()
    expect(Object.keys(meta.words).length).toBe(24)
    expect(favouriteWord(meta)).toEqual({ word: "w0089", count: 90 })
    // The joker map is bounded by the catalogue, so it is left alone — a joker
    // no longer in the game should still be able to have been a favourite.
    expect(Object.keys(meta.jokers).length).toBe(90)
  })

  it("carries the statistics across sessions", () => {
    const first = new Profile()
    first.guessed("crane")
    first.solved("crane", 1)
    first.took("banker")
    expect(new Profile().stats).toEqual(first.stats)
  })
})
