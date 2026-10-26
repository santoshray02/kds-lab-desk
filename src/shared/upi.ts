/** A UPI ID (virtual payment address) looks like name@bank. */
export const isUpiId = (v: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v.trim())

/** Keep only what a payee name may safely hold in a UPI link. */
const cleanText = (s: string, max: number) => s.replace(/[^\p{L}\p{N} .,&'()/@#:_-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * The link every UPI app understands (and that a phone camera turns into "Pay with …"). With an amount, the app opens with
 * the amount filled in; without one the payer types it. Amount is in rupees with two decimals, as the UPI rules say.
 */
export function upiLink(o: { upiId: string; name: string; amount?: number; note?: string }): string {
  if (!isUpiId(o.upiId)) throw new Error('The UPI ID is not valid. It looks like name@bank.')
  const q: string[] = [`pa=${encodeURIComponent(o.upiId.trim())}`]
  const pn = cleanText(o.name, 60)
  if (pn) q.push(`pn=${encodeURIComponent(pn)}`)
  if (o.amount !== undefined) {
    if (!(o.amount > 0) || o.amount > 1_000_000) throw new Error('The amount is not valid.')
    q.push(`am=${(Math.round(o.amount * 100) / 100).toFixed(2)}`)
  }
  q.push('cu=INR')
  const tn = cleanText(o.note ?? '', 50)
  if (tn) q.push(`tn=${encodeURIComponent(tn)}`)
  return `upi://pay?${q.join('&')}`
}
