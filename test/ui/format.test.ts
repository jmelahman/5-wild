import { describe, expect, it } from "vitest"
import { formatNumber, money } from "../../src/ui/format"

describe("score formatting", () => {
  it("writes small numbers out in full", () => {
    // Everything a normal run ever shows is on this side of the cut, and on this
    // side the digits are the point: a target of 1450 is checked against a score
    // of 1402 digit by digit, and no abbreviation helps with that.
    expect(formatNumber(0)).toBe("0")
    expect(formatNumber(300)).toBe("300")
    expect(formatNumber(1450)).toBe("1450")
    expect(formatNumber(9999)).toBe("9999")
  })

  it("abbreviates to three significant figures above it", () => {
    expect(formatNumber(10_000)).toBe("10K")
    expect(formatNumber(12_400)).toBe("12.4K")
    expect(formatNumber(148_392)).toBe("148K")
    expect(formatNumber(1_352_000)).toBe("1.35M")
    // Stage 20, roughly, which is the number that made this worth writing.
    expect(formatNumber(2_200_000_000)).toBe("2.2B")
    expect(formatNumber(4.5e12)).toBe("4.5T")
  })

  it("drops trailing zeros rather than padding to three", () => {
    expect(formatNumber(2_000_000)).toBe("2M")
    expect(formatNumber(2_500_000)).toBe("2.5M")
    expect(formatNumber(2_050_000)).toBe("2.05M")
  })

  it("carries into the next unit instead of printing 1000 of the last", () => {
    // 999,950 scales to 999.95K, and three significant figures rounds that to a
    // flat thousand. Printed as "1000K" it is both wrong-looking and one
    // character longer than the abbreviation was meant to allow.
    expect(formatNumber(999_950)).toBe("1M")
    expect(formatNumber(999_999_999)).toBe("1B")
    expect(formatNumber(999_000)).toBe("999K")
  })

  it("falls back to exponent notation past the ladder", () => {
    // Unreachable by any run, but endless has no ceiling to argue from, and a
    // number with no unit left would otherwise print as "undefined".
    expect(formatNumber(1e27)).toBe("1e27")
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("∞")
  })

  it("keeps the sign", () => {
    expect(formatNumber(-12_400)).toBe("-12.4K")
    expect(formatNumber(-5)).toBe("-5")
  })

  it("rounds fractions, which the meter and the solve floor both produce", () => {
    expect(formatNumber(1449.6)).toBe("1450")
    expect(formatNumber(0.4)).toBe("0")
  })

  it("prints gold through the same rule", () => {
    expect(money(4)).toBe("$4")
    expect(money(12_400)).toBe("$12.4K")
  })
})
