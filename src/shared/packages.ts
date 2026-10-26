/**
 * Share a package price over its tests in proportion to their usual prices, so each test line on the bill still
 * adds up to the package price. Whole rupees; the last test takes the rounding difference.
 */
export function splitPackagePrice(prices: number[], packagePrice: number): number[] {
  const n = prices.length
  if (!n) return []
  const target = Math.max(0, Math.round(packagePrice))
  const sum = prices.reduce((a, b) => a + b, 0)
  const out = prices.map((p) => Math.floor(sum > 0 ? (p / sum) * target : target / n))
  out[n - 1] += target - out.reduce((a, b) => a + b, 0)
  return out
}
