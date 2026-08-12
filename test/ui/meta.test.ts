import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadMeta, Profile } from "../../src/ui/meta"

const KEY = "5wild:meta:v1"

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

beforeEach(() => {
  store = new FakeStorage()
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage")
})

describe("reading the record", () => {
  it("starts everyone at nothing, with no win to their name", () => {
    expect(loadMeta()).toEqual({ runs: 0, wins: 0, bestAnte: 0, cleared: -1 })
  })

  it("reads back what was written", () => {
    store.items.set(KEY, JSON.stringify({ runs: 12, wins: 2, bestAnte: 14, cleared: 1 }))
    expect(loadMeta()).toEqual({ runs: 12, wins: 2, bestAnte: 14, cleared: 1 })
  })

  it("keeps the fields it can read when one of them is garbage", () => {
    // The opposite of `loadSave`, which throws a bad run away whole. Four
    // independent counters: a broken one is no reason to forget the rest.
    store.items.set(KEY, JSON.stringify({ runs: 9, wins: "lots", bestAnte: 6.5, cleared: null }))
    expect(loadMeta()).toEqual({ runs: 9, wins: 0, bestAnte: 0, cleared: -1 })
  })

  it("survives anything at all under its key", () => {
    for (const raw of ["", "not json", "null", "7", '"a string"', "[]"]) {
      store.items.set(KEY, raw)
      expect(loadMeta(), raw).toEqual({ runs: 0, wins: 0, bestAnte: 0, cleared: -1 })
    }
  })

  it("reads a record written before a field existed as zero on it", () => {
    store.items.set(KEY, JSON.stringify({ runs: 3 }))
    expect(loadMeta()).toEqual({ runs: 3, wins: 0, bestAnte: 0, cleared: -1 })
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
