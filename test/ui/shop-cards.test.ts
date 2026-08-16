import { describe, expect, it } from "vitest"
import type { RunState, ShopItem, WordSource } from "../../src/engine"
import { CONSUMABLE_SLOTS, difficultyOf, startRun } from "../../src/engine"
import { describeItem } from "../../src/ui/views"

const words: WordSource = { answers: ["braid"], allowed: new Set(["braid", "crane"]) }

const fresh = (): RunState => startRun(1, words).state

/**
 * One item of every kind the shelf can stock, with real ids. Hand-written rather
 * than rolled out of `rollShop`, because the point of the list is that it is
 * exhaustive: a kind added to `ShopItem` and not added here fails to compile,
 * which is the only moment anyone is thinking about the card that draws it.
 */
const ONE_OF_EACH: Record<ShopItem["kind"], ShopItem> = {
  relic: { kind: "relic", id: "snowball", cost: 6 },
  consumable: { kind: "consumable", id: "oracle", cost: 4 },
  etch: { kind: "etch", id: "etch_vowels", cost: 5 },
  level: { kind: "level", id: "twinned", cost: 8 },
  range: { kind: "range", id: "range_ae", cost: 7 },
  mod: { kind: "mod", id: "steel", cost: 6 },
  pack: { kind: "pack", id: "relic", cost: 10 },
}

describe("what a shop card says it is", () => {
  it("tags every kind the shelf can stock", () => {
    const state = fresh()
    for (const [kind, item] of Object.entries(ONE_OF_EACH)) {
      const { tag } = describeItem(item, state)
      // A blank tag is the failure this exists to catch: the card still draws,
      // still buys and still reads almost right, so nothing else would notice.
      expect(tag, `${kind} tag`).not.toBe("")
    }
  })

  it("names a relic's rarity but leaves common unremarked", () => {
    const state = fresh()
    // Snowball is rare, Keystone uncommon, Head Start common. Commons are most
    // of what the shelf deals, and a tag that said "Common Relic" three times a
    // visit would be teaching the player to stop reading tags.
    expect(describeItem(ONE_OF_EACH.relic, state).tag).toBe("Rare Relic")
    expect(describeItem({ kind: "relic", id: "keystone", cost: 6 }, state).tag).toBe(
      "Uncommon Relic",
    )
    expect(describeItem({ kind: "relic", id: "head_start", cost: 4 }, state).tag).toBe("Relic")
  })

  it("turns the tag into a warning when there is nowhere to put the card", () => {
    const state = fresh()
    const full: RunState = {
      ...state,
      relics: Array.from({ length: difficultyOf(state).relicSlots }, () => ({ id: "snowball" })),
      consumables: Array.from({ length: CONSUMABLE_SLOTS }, () => ({ id: "oracle" })),
    }

    const relic = describeItem(ONE_OF_EACH.relic, full)
    expect(relic.tag).toBe("Relic · tray full")
    expect(relic.blocked).toBe(true)

    const card = describeItem(ONE_OF_EACH.consumable, full)
    expect(card.tag).toBe("Card · slots full")
    expect(card.blocked).toBe(true)

    // The kinds that need no seat are never blocked, however full the run is —
    // an etching lands on letters that are always there.
    expect(describeItem(ONE_OF_EACH.etch, full).blocked).toBe(false)
    expect(describeItem(ONE_OF_EACH.pack, full).blocked).toBe(false)
  })
})
