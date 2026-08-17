/**
 * How a score is written down.
 *
 * The targets are geometric, since stage 1 asks for 300 and each one after it
 * asks for a little over twice the last, so by stage 8 the ask is in the millions and
 * an endless run, which has no last stage, has no last target either. Ten digits
 * do not fit on a phone beside the number chasing them, and past a point they
 * stop being read anyway: nobody compares 148,392,110 to 151,000,000 digit by
 * digit, they compare "148M" to "151M".
 *
 * So the cut is at ten thousand, not at a thousand. An early target of 1450 is
 * exactly the kind of number a player checks against digit by digit, and "1.45K"
 * is worse at that job than "1450". Above the cut, three significant figures
 * keeps the error under half a percent, which is far inside what a progress read
 * needs, and never runs past six characters.
 */

/** Long enough that the ladder outlasts any run; past it, exponent notation. */
const UNITS = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp"]

const PLAIN_BELOW = 10_000

/** Three significant figures, with trailing zeros dropped: 1.20 reads as 1.2. */
const significant = (scaled: number): number =>
  Number(scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2))

export function formatNumber(value: number): string {
  // Not reachable from the engine, which deals in finite integers, but the UI
  // divides by targets, and a screen reading "NaN" is worse than one reading 0.
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "0"

  const sign = value < 0 ? "-" : ""
  const size = Math.abs(value)
  if (size < PLAIN_BELOW) return `${sign}${Math.round(size)}`

  let step = Math.floor(Math.log10(size) / 3)
  // Rounding carries: 999,950 scales to 999.95K, which prints as "1000K" unless
  // the carry is allowed to move it up a unit first.
  if (significant(size / 1000 ** step) >= 1000) step += 1

  const unit = UNITS[step - 1]
  // Trailing zeros go here too, so the fallback reads like everything above it.
  if (!unit)
    return `${sign}${size
      .toExponential(2)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e")}`
  return `${sign}${significant(size / 1000 ** step)}${unit}`
}

/** Gold. Small all run, but an endless run is long and interest compounds. */
export const money = (amount: number): string => `$${formatNumber(amount)}`
