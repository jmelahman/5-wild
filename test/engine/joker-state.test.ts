import { afterAll, describe, expect, it } from "vitest"
import type { Action, Joker, RunState, WordSource } from "../../src/engine"
import { JOKER_BY_ID, reduce, startRun } from "../../src/engine"

/**
 * The scaling machinery, tested with fixtures rather than with shipped content.
 *
 * P1 adds the primitive and no jokers that use it, on purpose: anything added to
 * `JOKERS` would shift what the shop rolls and move every golden vector, which
 * would cost this phase the one guarantee that proves it is a pure refactor.
 *
 * So the fixtures go into `JOKER_BY_ID` only — the map scoring and the reducer
 * look jokers up in — and never into `JOKERS`, which is what the shop reads.
 */

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "dairy"]),
}

const apply = (state: RunState, actions: Action[], source = words): RunState =>
  actions.reduce((current, action) => reduce(current, action, source).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

const FIXTURES: Joker[] = [
  {
    // Counts its own firings and pays what it has counted.
    id: "test_grower",
    name: "Test Grower",
    text: "grows",
    rarity: "common",
    cost: 4,
    onGuess: (ctx) => {
      const grown = ctx.getData("n") + 1
      ctx.setData("n", grown)
      ctx.addMult(grown)
    },
    detail: (instance) => `+${instance.data?.n ?? 0} mult`,
  },
  {
    // Writes then reads inside one guess, to prove reads see uncommitted writes.
    id: "test_readback",
    name: "Test Readback",
    text: "reads its own write",
    rarity: "common",
    cost: 4,
    onGuess: (ctx) => {
      ctx.setData("x", 41)
      ctx.addMult(ctx.getData("x") + 1)
    },
  },
  {
    // Records both streams so they can be compared for collision.
    id: "test_roller",
    name: "Test Roller",
    text: "rolls",
    rarity: "common",
    cost: 4,
    onTile: (ctx, _tile, index) => {
      if (index === 0) ctx.setData("tileRoll", Math.floor(ctx.roll() * 1e9))
    },
    onGuess: (ctx) => ctx.setData("guessRoll", Math.floor(ctx.roll() * 1e9)),
  },
  {
    id: "test_ender",
    name: "Test Ender",
    text: "grows when a blind ends",
    rarity: "common",
    cost: 4,
    onBlindEnd: (ctx, blind) => {
      const grown = (ctx.instance.data?.ends ?? 0) + 1
      ctx.instance.data = { ...ctx.instance.data, ends: grown, solved: blind.solved ? 1 : 0 }
      ctx.events.push({
        type: "joker_grew",
        slot: ctx.slot,
        id: "test_ender",
        label: `${grown}`,
      })
    },
  },
]

for (const fixture of FIXTURES) JOKER_BY_ID.set(fixture.id, fixture)
afterAll(() => {
  for (const fixture of FIXTURES) JOKER_BY_ID.delete(fixture.id)
})

/** A run holding one fixture joker, with the given words played. */
function withFixture(id: string, ...guesses: string[]): RunState {
  const base = startRun(1, words).state
  let state: RunState = { ...base, jokers: [{ id }] }
  for (const word of guesses) state = apply(state, type(word))
  return state
}

describe("joker instance state", () => {
  it("carries a counter across guesses", () => {
    // CRANE alone is 7 chips x 7 mult, so the joker's contribution reads as a
    // delta: +1 on the first firing, +2 on the second, +3 on the third.
    const state = withFixture("test_grower", "crane", "crane", "crane")
    expect(state.blind.guesses.map((guess) => guess.mult)).toEqual([8, 9, 10])
    expect(state.jokers[0]?.data).toEqual({ n: 3 })
  })

  it("reads back a write made earlier in the same guess", () => {
    const state = withFixture("test_readback", "crane")
    expect(state.blind.guesses[0]?.mult).toBe(7 + 42)
  })

  it("leaves a joker that never writes without a data field", () => {
    // The save is the reason this matters: an empty object on every joker would
    // be pure weight, and `data` is optional precisely so it stays absent.
    const state = withFixture("green_thumb", "crane", "crane")
    expect(state.jokers[0]).toEqual({ id: "green_thumb" })
    expect(state.jokers[0]?.data).toBeUndefined()
  })

  it("survives the save round trip", () => {
    const state = withFixture("test_grower", "crane", "crane")
    const revived = JSON.parse(JSON.stringify(state)) as RunState
    expect(revived.jokers[0]?.data).toEqual({ n: 2 })

    // And keeps counting from where the save left off rather than from zero.
    const resumed = apply(revived, type("crane"))
    expect(resumed.blind.guesses[2]?.mult).toBe(10)
  })

  it("does not let one joker read another's counter", () => {
    const base = startRun(1, words).state
    const state: RunState = { ...base, jokers: [{ id: "test_grower" }, { id: "test_grower" }] }
    const played = apply(state, type("crane"))
    // Both fire, each counting only itself: 7 + 1 + 1.
    expect(played.blind.guesses[0]?.mult).toBe(9)
    expect(played.jokers.map((instance) => instance.data)).toEqual([{ n: 1 }, { n: 1 }])
  })

  it("reports what it has grown to", () => {
    const state = withFixture("test_grower", "crane", "crane")
    const joker = JOKER_BY_ID.get("test_grower")
    expect(joker?.detail?.(state.jokers[0] ?? { id: "test_grower" })).toBe("+2 mult")
  })
})

describe("the joker roll", () => {
  it("replays identically from the same seed", () => {
    const first = withFixture("test_roller", "crane")
    const second = withFixture("test_roller", "crane")
    expect(first.jokers[0]?.data).toEqual(second.jokers[0]?.data)
  })

  it("gives the tile and guess hooks separate streams", () => {
    // Same slot, same guess — the two coordinates differ only in length, so this
    // is the case a naive derive() key would collide on.
    const data = withFixture("test_roller", "crane").jokers[0]?.data
    expect(data?.tileRoll).toBeDefined()
    expect(data?.guessRoll).toBeDefined()
    expect(data?.tileRoll).not.toBe(data?.guessRoll)
  })

  it("differs between runs with different seeds", () => {
    const one = { ...startRun(1, words).state, jokers: [{ id: "test_roller" }] }
    const two = { ...startRun(9, words).state, jokers: [{ id: "test_roller" }] }
    expect(apply(one, type("crane")).jokers[0]?.data?.guessRoll).not.toBe(
      apply(two, type("crane")).jokers[0]?.data?.guessRoll,
    )
  })
})

describe("the run-level hooks", () => {
  it("fires onBlindEnd with the finished blind", () => {
    // BRAID is the answer, so this blind ends solved.
    const state = withFixture("test_ender", "braid")
    expect(state.jokers[0]?.data).toEqual({ ends: 1, solved: 1 })
  })

  it("fires onBlindEnd on a loss too", () => {
    // Six wrong guesses: the blind ends done and unsolved.
    const state = withFixture("test_ender", "crane", "crane", "crane", "crane", "crane", "crane")
    expect(state.blind.done).toBe(true)
    expect(state.jokers[0]?.data).toEqual({ ends: 1, solved: 0 })
  })

  it("emits joker_grew pointing at the slot that grew", () => {
    const base = startRun(1, words).state
    // Slot 0 is a joker that never grows, so the slot in the event has to have
    // been read from the growing card rather than assumed to be the first one.
    let state: RunState = { ...base, jokers: [{ id: "green_thumb" }, { id: "test_ender" }] }
    for (const letter of "braid") {
      state = reduce(state, { type: "type_letter", letter }, words).state
    }
    const { events } = reduce(state, { type: "submit" }, words)
    expect(events).toContainEqual({ type: "joker_grew", slot: 1, id: "test_ender", label: "1" })
  })

  it("fires onShopEnter before the shop is rolled", () => {
    let shopAtFire: unknown = "never fired"
    JOKER_BY_ID.set("test_shopper", {
      id: "test_shopper",
      name: "Test Shopper",
      text: "watches the shop",
      rarity: "common",
      cost: 4,
      onShopEnter: (ctx) => {
        shopAtFire = ctx.state.shop
      },
    })

    let state = withFixture("test_shopper", "braid")
    state = apply(state, [{ type: "collect" }])

    // Null at fire time and populated after: the hook genuinely precedes the roll,
    // which is what lets a joker bend the stock it is about to be offered.
    expect(shopAtFire).toBeNull()
    expect(state.shop).not.toBeNull()
    JOKER_BY_ID.delete("test_shopper")
  })
})
