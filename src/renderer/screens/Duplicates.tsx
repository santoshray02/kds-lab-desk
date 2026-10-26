import { useEffect, useState } from 'react'
import { api, fmtDate, Modal, useApp, useAsync } from '../ui'

interface P { id: number; title: string; name: string; sex: string; phone: string; village: string; source: string; visits: number; lastVisit: string | null }

const KEY = 'kds-dup-dismissed'
const loadDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const saveDismissed = (v: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private window: forget it next time */ } }

/** Asks for the PIN, explains what merging does, then joins the two records. Returns true when it happened. */
export function useMerge() {
  const { t, askPin, confirm, guard, toast } = useApp()
  return async (keep: P, drop: P): Promise<boolean> => {
    const ps = await api.settings.pinStatus()
    const pin = ps.ownerSet ? await askPin(t('PIN to merge two people')) : ''
    if (pin === null) return false
    const sure = await confirm({
      title: t('Merge these two records?'),
      body: (
        <span>
          <b>{keep.title ? keep.title + '. ' : ''}{keep.name}</b> {t('is kept.')}<br />
          {drop.visits} {t('visits of')} <b>{drop.name}</b> {t('move to the kept person, and the extra record is removed.')}<br />
          {t('Reports of those visits will show the kept name and details. This cannot be undone.')}
        </span>
      ),
      ok: t('Yes, merge'),
      danger: true
    })
    if (!sure) return false
    const r = await guard(api.patients.merge(keep.id, drop.id, pin || undefined))
    if (r) toast(`${t('Merged')} · ${r.moved} ${t('visits moved')}`, 'ok')
    return !!r
  }
}

function PersonBox({ p, label, onKeep }: { p: P; label: string; onKeep: () => void }) {
  const { t } = useApp()
  return (
    <div className="card col" style={{ flex: 1, gap: 4 }}>
      <b>{p.title ? p.title + '. ' : ''}{p.name}</b>
      <div className="muted">{p.sex === 'F' ? t('Female') : t('Male')} · <span className="mono">{p.phone || t('no phone')}</span> · {p.village || '—'}</div>
      <div className="muted">{p.visits} {t('visits')} · {t('Last visit')}: {fmtDate(p.lastVisit)} {p.source !== 'app' && <span className="tag grey">{p.source === 'imported' ? t('imported') : t('demo')}</span>}</div>
      <div><button className="btn" onClick={onKeep} data-testid="keep-this">{label}</button></div>
    </div>
  )
}

export function DuplicatesTab() {
  const { t } = useApp()
  const merge = useMerge()
  const found = useAsync(() => api.patients.duplicates(), [])
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed())
  const key = (a: P, b: P) => `${a.id}-${b.id}`
  const list = (found.data ?? []).filter((x) => !dismissed.includes(key(x.a, x.b)))
  return (
    <div className="col" data-testid="duplicates">
      <div className="muted">{t('These people may be registered twice. Check each pair, then choose which record to keep. Family members on one phone are not listed.')}</div>
      {found.loading && <div className="muted">{t('Looking…')}</div>}
      {!found.loading && list.length === 0 && <div className="alert info"><b>✔</b><span>{t('No duplicates found.')}</span></div>}
      {list.map((x) => (
        <div key={key(x.a, x.b)} className="col" data-testid="dup-pair">
          <div className="muted" style={{ fontWeight: 600 }}>{t(x.reason)}</div>
          <div className="row" style={{ alignItems: 'stretch' }}>
            <PersonBox p={x.a} label={t('Keep this one')} onKeep={async () => { if (await merge(x.a, x.b)) found.reload() }} />
            <PersonBox p={x.b} label={t('Keep this one')} onKeep={async () => { if (await merge(x.b, x.a)) found.reload() }} />
          </div>
          <div><button className="btn ghost small" onClick={() => { const n = [...dismissed, key(x.a, x.b)]; setDismissed(n); saveDismissed(n) }}>{t('These are different people')}</button></div>
        </div>
      ))}
    </div>
  )
}

/** On a person's page: pick another record of the same person and merge it into this one. */
export function MergeButton({ person, onDone }: { person: P; onDone: () => void }) {
  const { t } = useApp()
  const merge = useMerge()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  useEffect(() => { const id = setTimeout(() => setDq(q), 250); return () => clearTimeout(id) }, [q])
  const res = useAsync(() => (open && dq.trim().length > 1 ? api.patients.search(dq) : Promise.resolve([])), [open, dq])
  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} data-testid="merge-open">⇄ {t('Merge with another record')}</button>
      {open && (
        <Modal onClose={() => setOpen(false)} wide>
          <h2>{t('Merge with another record')}</h2>
          <div className="muted">{t('Search for the second record of')} <b>{person.name}</b>. {t('This person’s record is kept.')}</div>
          <input className="input" autoFocus placeholder={t('Name, village, phone number or sample ID')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="merge-search" />
          <div className="col" style={{ maxHeight: 280, overflow: 'auto', gap: 6 }}>
            {res.data?.filter((p) => p.id !== person.id && p.sex === person.sex).map((p) => (
              <div key={p.id} className="card row wrap" data-testid="merge-candidate">
                <div className="grow"><b>{p.title ? p.title + '. ' : ''}{p.name}</b><div className="muted">{p.phone || t('no phone')} · {p.village} · {p.visitCount} {t('visits')}</div></div>
                <button className="btn small" onClick={async () => {
                  const other: P = { id: p.id, title: p.title, name: p.name, sex: p.sex, phone: p.phone, village: p.village, source: p.source, visits: p.visitCount, lastVisit: p.lastVisitDate }
                  if (await merge(person, other)) { setOpen(false); onDone() }
                }} data-testid="merge-pick">{t('Merge into this person')}</button>
              </div>
            ))}
            {dq.trim().length > 1 && res.data?.filter((p) => p.id !== person.id && p.sex === person.sex).length === 0 && <div className="muted">{t('Nobody found.')}</div>}
          </div>
          <div className="row"><div className="grow" /><button className="btn ghost" onClick={() => setOpen(false)}>{t('Cancel')}</button></div>
        </Modal>
      )}
    </>
  )
}
