// Supabase Edge Function (Deno): checks the PIN for a report link and returns a short-lived PDF link.
// Deploy:  supabase functions deploy get-report --no-verify-jwt
// Called by cloud/report-page/index.html with { code, pin } (or { code } for the public status only).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { decide, publicStatus, MAX_FAILS, WINDOW_MINUTES, type ReportRecord } from './logic.ts'

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): void }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: { code?: string; pin?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad request' }, 400)
  }
  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  if (!code) return json({ error: 'missing code' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: reps } = await db.from('reports').select('*').eq('share_code', code).eq('status', 'approved').order('version', { ascending: false })
  const rec = ((reps ?? []).find((r: ReportRecord) => r.is_current) ?? (reps ?? [])[0] ?? null) as ReportRecord | null

  // no PIN given: tell the QR scanner whether the report is genuine, nothing more
  if (body.pin === undefined) {
    const newer = !!rec && (reps ?? []).some((r: ReportRecord) => r.version > rec.version)
    return json(publicStatus(rec, newer))
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const { count } = await db.from('report_access_log').select('id', { count: 'exact', head: true }).eq('share_code', code).eq('ok', false).gte('at', since)
  const d = await decide(rec, String(body.pin), count ?? 0)
  if (d.kind === 'not_found') return json({ error: 'not_found' }, 404)
  if (d.kind === 'locked') return json({ error: 'locked', retryAfterMinutes: d.retryAfterMinutes }, 429)
  await db.from('report_access_log').insert({ share_code: code, ok: d.kind === 'ok' })
  if (d.kind === 'bad_pin') return json({ error: 'bad_pin', attemptsLeft: d.attemptsLeft, maxFails: MAX_FAILS }, 401)
  const { data: signed } = await db.storage.from('reports').createSignedUrl(d.path, 600)
  if (!signed) return json({ error: 'file_missing' }, 404)
  return json({ url: signed.signedUrl, version: rec!.version })
})
