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
  it("tags every kind the shelf can stock, and explains every tag", () => {
    const state = fresh()
    for (const [kind, item] of Object.entries(ONE_OF_EACH)) {
      const { tag, tip } = describeItem(item, state)
      // A blank tag is the failure this exists to catch: the card still draws,
      // still buys and still reads almost right, so nothing else would notice.
      expect(tag, `${kind} tag`).not.toBe("")
      // Same failure one layer down. A missing tip is an inert ticket: the
      // hover panel simply never opens, which looks like nothing at all.
      expect(tip, `${kind} tip`).not.toBe("")
      // The panel is `pre-line`, so a tip wrapped in the source would arrive
      // with the source's own line breaks in it.
      expect(tip, `${kind} tip`).not.toContain("\n")
      // A tip is read in the second the pointer rests on the ticket, over the
      // top of the shelf it is explaining. The limit is what one plain sentence
      // fits in, and anything that wants more of the player's attention than
      // that belongs in the rules sheet or the codex, where they went to read.
      expect(tip.length, `${kind} tip length`).toBeLessThanOrEqual(80)
      // The panel's voice is plain speech, and a dash in it is the sound of
      // copy written to look considered rather than to be read quickly.
      expect(tip, `${kind} tip`).not.toContain("—")
    }
  })

  it("says the kind and leaves the rarity to the colour", () => {
    const state = fresh()
    // Snowball is rare, Keystone uncommon, Head Start common — one tag between
    // them. Rarity is on the border, on the tag's own ink and on the tray the
    // relic is bound for; saying it a fourth time cost the name room on the
    // line and pushed the kind, which is what the tag is for, into second place.
    for (const id of ["snowball", "keystone", "head_start"]) {
      expect(describeItem({ kind: "relic", id, cost: 6 }, state).tag, id).toBe("Relic")
    }
    // The rarity itself still comes back, because the card is coloured by it.
    expect(describeItem(ONE_OF_EACH.relic, state).rarity).toBe("rare")
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
    expect(card.tag).toBe("Consumable · slots full")
    expect(card.blocked).toBe(true)

    // The kinds that need no seat are never blocked, however full the run is —
    // an etching lands on letters that are always there.
    expect(describeItem(ONE_OF_EACH.etch, full).blocked).toBe(false)
    expect(describeItem(ONE_OF_EACH.pack, full).blocked).toBe(false)
  })
})
