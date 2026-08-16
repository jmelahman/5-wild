import { describe, expect, it } from "vitest"
import type { Action, GuessRecord, ModId, RunState, WordSource } from "../../src/engine"
import { MODIFIERS, reduce, startRun } from "../../src/engine"

/**
 * Letter modifiers. The baselines these read against are the same two words the
 * relic tests use: against BRAID, CRANE is 7 chips × 7 mult and QUAZY is 26 × 4.
 * Every expectation below is a delta from one of those.
 */

const words: WordSource = {
  answers: ["braid"],
  allowed: new Set(["braid", "crane", "quazy", "sassy", "aahed", "arose"]),
}

const apply = (state: RunState, actions: Action[], source = words): RunState =>
  actions.reduce((current, action) => reduce(current, action, source).state, state)

const type = (word: string): Action[] => [
  ...[...word].map((letter): Action => ({ type: "type_letter", letter })),
  { type: "submit" },
]

/** A run whose alphabet carries one modified letter. */
function withMod(letter: string, mod: ModId, seed = 1): RunState {
  const base = startRun(seed, words).state
  const entry = base.letters[letter]
  if (!entry) throw new Error(`no such letter: ${letter}`)
  return { ...base, letters: { ...base.letters, [letter]: { ...entry, mod } } }
}

/** Plays one guess with a modified letter and hands back the scored record. */
function play(
  letter: string,
  mod: ModId,
  word: string,
  seed = 1,
): { last: GuessRecord; state: RunState } {
  const state = apply(withMod(letter, mod, seed), type(word))
  const last = state.round.guesses[state.round.guesses.length - 1]
  if (!last) throw new Error("no guess was scored")
  return { last, state }
}

describe("letter modifiers", () => {
  it("leaves an unmodified letter alone", () => {
    const state = apply(startRun(1, words).state, type("crane"))
    expect(state.round.guesses[0]).toMatchObject({ chips: 7, mult: 7 })
  })

  it("Chip pays flat chips wherever the letter lands", () => {
    expect(play("c", "chip", "crane").last).toMatchObject({ chips: 27, mult: 7 })
  })

  it("Mult pays flat mult", () => {
    expect(play("c", "mult", "crane").last).toMatchObject({ chips: 7, mult: 11 })
  })

  it("Gold pays into the run, not into the score", () => {
    const { last, state } = play("c", "gold", "crane")
    expect(last).toMatchObject({ chips: 7, mult: 7 })
    expect(state.gold).toBe(startRun(1, words).state.gold + 2)
  })

  it("Steel multiplies what the word has scored so far", () => {
    // The multiply lands where the tile does, so position is worth real mult:
    // CRANE's E is last and multiplies the finished 7, its C is first and
    // multiplies the 1 that was there at the time — and the 6 between those two
    // is the whole reason the rule is worth having.
    expect(play("e", "steel", "crane").last.mult).toBe(14)
    expect(play("c", "steel", "crane").last.mult).toBe(8)
  })

  it("Steel multiplies once per copy of the letter", () => {
    // SASSY's three Ss each multiply in turn: 1 ×2, +1 for the yellow A, then
    // ×2 twice more.
    expect(play("s", "steel", "sassy").last.mult).toBe(12)
  })

  it("Wild scores its tile as green whatever it landed", () => {
    // QUAZY's Q is gray and worth no mult at all; wild makes it worth three.
    expect(play("q", "wild", "quazy").last).toMatchObject({ chips: 26, mult: 7 })
    // A green tile is already scoring as green, so there is nothing to add.
    expect(play("a", "wild", "quazy").last.mult).toBe(4)
  })

  it("Glass triples the mult", () => {
    // Q is QUAZY's first tile, so the ×3 lands on the 1 that is there then; the
    // green A adds its 3 afterwards.
    expect(play("q", "glass", "quazy").last.mult).toBe(6)
  })

  it("Glass can shatter on a gray tile, and says so", () => {
    // U is the second tile of QUAZY and absent from BRAID: both conditions the
    // break needs. The roll is derived from the tile's coordinates, so this is
    // the same outcome on every machine and every replay.
    const { state } = play("u", "glass", "quazy")
    expect(state.letters.u?.destroyed).toBe(true)

    const typed = apply(withMod("u", "glass"), type("quazy").slice(0, -1))
    const { events } = reduce(typed, { type: "submit" }, words)
    expect(events).toContainEqual({ type: "letter_destroyed", letter: "u" })
  })

  it("Glass survives a tile that scored", () => {
    // Q is the first tile, whose roll misses. A modifier that broke on every
    // gray would be a countdown rather than a gamble.
    expect(play("q", "glass", "quazy").state.letters.q?.destroyed).toBe(false)
  })

  it("Glass never shatters a letter the answer needs", () => {
    // AAHED's second A is gray — BRAID's only A is spoken for by the first —
    // and its roll would break. Burning it would leave a round nobody could
    // solve, so the answer is checked before the dice are.
    const { state } = play("a", "glass", "aahed")
    expect(state.letters.a?.destroyed).toBe(false)
  })

  it("fires before the relics see the tile", () => {
    // Both land on CRANE's A: 4 mult standing, +3 for the green, ×2 from steel
    // is 14, and only then Vowel Hoarder's +4 — twice over, counting the E. The
    // other order would have multiplied the relic's mult too, for 26.
    const state = { ...withMod("a", "steel"), relics: [{ id: "vowel_hoarder" }] }
    expect(apply(state, type("crane")).round.guesses[0]?.mult).toBe(22)
  })

  it("gives every modifier a distinct id, name and price", () => {
    expect(new Set(MODIFIERS.map((mod) => mod.id)).size).toBe(MODIFIERS.length)
    expect(new Set(MODIFIERS.map((mod) => mod.name)).size).toBe(MODIFIERS.length)
    for (const mod of MODIFIERS) expect(mod.cost).toBeGreaterThan(0)
  })
})

describe("buying a modifier", () => {
  /** A shop holding one modifier card, so the purchase path can be exercised. */
  function shopping(item: { letter: string; id: ModId; cost: number }): RunState {
    const base = startRun(1, words).state
    return {
      ...base,
      phase: "shop",
      gold: 20,
      shop: { items: [{ kind: "mod", ...item }], rerolls: 0 },
    }
  }

  it("sticks the modifier to the letter and charges for it", () => {
    const state = apply(shopping({ letter: "e", id: "steel", cost: 8 }), [
      { type: "buy", index: 0 },
    ])
    expect(state.letters.e?.mod).toBe("steel")
    expect(state.gold).toBe(12)
    expect(state.shop?.items[0]).toBeNull()
  })

  it("replaces rather than stacks", () => {
    const bought = apply(shopping({ letter: "e", id: "steel", cost: 8 }), [
      { type: "buy", index: 0 },
    ])
    const again = apply(
      {
        ...bought,
        shop: { items: [{ kind: "mod", letter: "e", id: "gold", cost: 6 }], rerolls: 0 },
      },
      [{ type: "buy", index: 0 }],
    )
    expect(again.letters.e?.mod).toBe("gold")
  })

  it("leaves an etching alone — the two upgrades stack with each other", () => {
    const state = apply(shopping({ letter: "e", id: "chip", cost: 4 }), [{ type: "buy", index: 0 }])
    expect(state.letters.e).toMatchObject({ etch: 0, mod: "chip" })
  })

  it("Anchor pays only where the letter lands green", () => {
    // Against BRAID, CRANE puts R and A in their right places and everything
    // else wrong — so the same card is worth +250 on R and nothing on C. The
    // gap between those two numbers is the card: what it is worth depends on
    // the letter it was sold on, not on the price it was sold at.
    expect(play("r", "anchor", "crane").last).toMatchObject({ chips: 257, mult: 7 })
    expect(play("c", "anchor", "crane").last).toMatchObject({ chips: 7, mult: 7 })
  })

  it("Echo pays on every copy of a letter the word repeats", () => {
    // AAHED carries two As, so Echo fires twice — the card is bought for the
    // words that double it, and is worth nothing in the ones that do not.
    const plain = apply(startRun(1, words).state, type("aahed")).round.guesses[0]
    if (!plain) throw new Error("no guess was scored")
    expect(play("a", "echo", "aahed").last.chips - plain.chips).toBe(120)
    // And nothing at all in a word that holds only one of it.
    expect(play("a", "echo", "crane").last).toMatchObject({ chips: 7, mult: 7 })
  })

  it("Lucky fires on a quarter of tiles, and always the same ones", () => {
    // Walked across seeds rather than pinned to one: what is under test is that
    // the chance is real in both directions and that it replays, not which
    // particular draw a magic seed happens to produce.
    const mults = Array.from({ length: 40 }, (_, i) => play("c", "lucky", "crane", i + 1).last.mult)

    expect(new Set(mults)).toEqual(new Set([7, 27]))
    expect(mults.filter((mult) => mult === 27).length).toBeGreaterThan(2)
    expect(mults.filter((mult) => mult === 7).length).toBeGreaterThan(2)
    expect(play("c", "lucky", "crane", 1).last.mult).toBe(mults[0])
  })

  it("is something the shop actually offers", () => {
    // Walked across seeds rather than asserted on one: the roll table is
    // weighted, and what matters is that the kind reaches the stock at all.
    const offered = Array.from({ length: 40 }, (_, seed) => {
      const state = startRun(seed, words).state
      return {
        ...state,
        phase: "reward" as const,
        reward: { base: 3, unusedGuesses: 0, interest: 0, total: 3 },
      }
    })
      .map((state) => reduce(state, { type: "collect" }, words).state)
      .flatMap((state) => state.shop?.items ?? [])
      .filter((item) => item?.kind === "mod")

    expect(offered.length).toBeGreaterThan(0)
    // Never a letter that is already carrying the same thing, and never one
    // that has been burnt out of the alphabet.
    for (const item of offered) expect(item.cost).toBeGreaterThan(0)
  })
})
