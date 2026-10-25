import { useEffect, useMemo, useRef, useState } from 'react'
import { formatAge, sexForTitle, titleChecks, TITLES } from '../../shared/age'
import { SECTION_ORDER } from '../../shared/masterData'
import type { PanelDef, Sex } from '../../shared/types'
import { api, enterNext, Field, fmtDate, money, useApp, useAsync, type Person } from '../ui'

export function NewPatient({ personId }: { personId?: number }) {
  const { t, go, toast, guard, settings } = useApp()
  const master = useAsync(() => api.master.list(), [])
  const formRef = useRef<HTMLDivElement>(null)

  const [phone, setPhone] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [picked, setPicked] = useState<number | 'new' | null>(null)
  const [title, setTitle] = useState('Mr')
  const [name, setName] = useState('')
  const [sex, setSex] = useState<Sex | ''>('M')
  const [years, setYears] = useState('')
  const [months, setMonths] = useState('')
  const [days, setDays] = useState('')
  const [village, setVillage] = useState('')
  const [doctor, setDoctor] = useState('')
  const [docList, setDocList] = useState<string[]>([])
  const [codes, setCodes] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')
  const [saving, setSaving] = useState(false)
  const [warnOk, setWarnOk] = useState(false)

  const digits = phone.replace(/\D/g, '').slice(-10)

  // everyone using this phone number (families share one phone)
  useEffect(() => {
    if (digits.length === 10) api.patients.byPhone(digits).then((p) => { setPeople(p); if (!p.length) setPicked('new') })
    else { setPeople([]); setPicked(null) }
  }, [digits])

  // opened from a patient page: prefill from that person
  useEffect(() => {
    if (!personId) return
    api.patients.get(personId).then((p) => { if (p) { setPhone(p.phone); api.patients.byPhone(p.phone).then((list) => { setPeople(list); const m = list.find((x) => x.id === p.id); if (m) pick(m) }) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId])

  useEffect(() => { api.patients.doctors(doctor).then(setDocList) }, [doctor])

  function pick(p: Person) {
    setPicked(p.id)
    setTitle(p.title || (p.sex === 'F' ? 'Mrs' : 'Mr'))
    setName(p.name)
    setSex(p.sex)
    setVillage(p.village)
    setDoctor(p.lastDoctor ?? '')
    if (p.ageNow) { setYears(p.ageNow.years ? String(p.ageNow.years) : ''); setMonths(p.ageNow.months ? String(p.ageNow.months) : ''); setDays(p.ageNow.days ? String(p.ageNow.days) : '') }
    setWarnOk(false)
  }
  function newPerson() {
    setPicked('new'); setName(''); setTitle('Mr'); setSex('M'); setYears(''); setMonths(''); setDays(''); setVillage('')
  }

  function changeTitle(v: string) {
    setTitle(v)
    const s = sexForTitle(v)
    if (s) setSex(s)
    else setSex('')
    setWarnOk(false)
  }

  const panels = (master.data ?? []).filter((p) => p.active && p.bundleCodes.length === 0 && p.price >= 0)
  const bundles = (master.data ?? []).filter((p) => p.active && p.bundleCodes.length > 0)
  const bySection = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const m = new Map<string, PanelDef[]>()
    for (const p of panels) {
      if (f && !(p.name.toLowerCase().includes(f) || p.code.toLowerCase().includes(f))) continue
      if (!m.has(p.section)) m.set(p.section, [])
      m.get(p.section)!.push(p)
    }
    return [...m.entries()].sort((a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.data, filter])

  const priceOf = (c: string) => panels.find((p) => p.code === c)?.price ?? 0
  const gross = [...codes].reduce((a, c) => a + priceOf(c), 0)
  const disc = Math.max(0, Number(discount) || 0)
  const total = Math.max(0, gross - disc)
  const paidN = Math.max(0, Number(paid) || 0)

  const age = { years: Number(years) || 0, months: Number(months) || 0, days: Number(days) || 0 }
  const warnings = sex ? titleChecks(title, sex, age).filter((w) => name.trim() || !w.startsWith('Age')) : []
  const ageGiven = age.years + age.months + age.days > 0

  function toggle(c: string) {
    setCodes((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n })
  }
  function toggleBundle(b: PanelDef) {
    setCodes((s) => {
      const n = new Set(s)
      const all = b.bundleCodes.every((c) => n.has(c))
      for (const c of b.bundleCodes) all ? n.delete(c) : n.add(c)
      return n
    })
  }

  const needPhone = settings.phoneRequired && digits.length !== 10
  const canSave = name.trim().length > 1 && !!sex && ageGiven && codes.size > 0 && !needPhone && (phone === '' || digits.length === 10)

  async function save() {
    if (!canSave || saving) return
    if (warnings.length && !warnOk) { setWarnOk(true); toast(t('Please check the yellow warning, then press Save again.'), ''); return }
    setSaving(true)
    const r = await guard(api.visits.create({
      patient: { id: typeof picked === 'number' ? picked : undefined, name, title, sex: sex as Sex, phone: digits, village },
      age, doctor: doctor || 'Self', panelCodes: [...codes], discount: disc, paid: Math.min(paidN, total)
    }))
    setSaving(false)
    if (r) {
      toast(`${t('Saved')} · ${t('Sample ID')} ${r.sampleId}`, 'ok')
      go({ name: 'visit', visitId: r.visitId })
    }
  }

  return (
    <div className="page" ref={formRef} onKeyDown={(e) => enterNext(e, save)} data-testid="new-patient">
      <h1>{t('New patient')} <span className="muted" style={{ fontSize: 18 }}>नया मरीज़</span></h1>

      <div className="card col">
        <div className="grid2">
          <Field label={t('Phone (finds the family)') + (settings.phoneRequired ? ' *' : ` (${t('optional')})`)}>
            <input className="input mono" inputMode="tel" data-nav data-testid="phone" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxx xxxxx" />
          </Field>
          <div className="muted" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            {digits.length === 10 ? (people.length ? `${people.length} ${t('people use this number')}` : t('New number')) : t('Without a phone you can only print, not WhatsApp.')}
          </div>
        </div>

        {people.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>{t('Who is the patient today?').toUpperCase()}</span>
            <div className="chips">
              {people.map((p) => (
                <button key={p.id} className={`person${picked === p.id ? ' on' : ''}`} onClick={() => pick(p)} data-testid="person" type="button">
                  <b>{p.title ? p.title + '. ' : ''}{p.name}</b>
                  <span className="muted">{p.ageNow ? formatAge(p.ageNow) : ''} · {p.sex === 'F' ? t('Female') : t('Male')} · {p.village}</span>
                  <span className="muted" style={{ fontSize: 14 }}>{t('Last visit')}: {fmtDate(p.lastVisitDate)} ({p.visitCount})</span>
                </button>
              ))}
              <button className={`person${picked === 'new' ? ' on' : ''}`} onClick={newPerson} type="button" data-testid="person-new"><b>+ {t('New person on this number')}</b></button>
            </div>
          </div>
        )}

        <div className="grid4" style={{ gridTemplateColumns: '130px 1fr 130px' }}>
          <Field label={t('Title')}>
            <select className="input" data-nav data-testid="title" value={title} onChange={(e) => changeTitle(e.target.value)}>
              {TITLES.map((x) => <option key={x} value={x}>{x}.</option>)}
            </select>
          </Field>
          <Field label={t('Name')}>
            <input className="input" data-nav data-testid="name" value={name} onChange={(e) => { setName(e.target.value); setWarnOk(false) }} />
          </Field>
          <Field label={t('Sex')}>
            <select className="input" data-nav data-testid="sex" value={sex} onChange={(e) => { setSex(e.target.value as Sex); setWarnOk(false) }}>
              {sex === '' && <option value="">—</option>}
              <option value="M">{t('Male')}</option>
              <option value="F">{t('Female')}</option>
            </select>
          </Field>
        </div>

        <div className="grid4">
          <Field label={t('Age: Years')}><input className="input num" inputMode="numeric" data-nav data-testid="age-years" value={years} onChange={(e) => setYears(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
          <Field label={t('Months')}><input className="input num" inputMode="numeric" data-nav value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
          <Field label={t('Days')}><input className="input num" inputMode="numeric" data-nav value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
          <Field label={t('Village / place')}><input className="input" data-nav data-testid="village" value={village} onChange={(e) => setVillage(e.target.value)} /></Field>
        </div>
        {warnings.map((w) => <div className="alert warn" key={w} data-testid="title-warning"><b>⚠</b><span>{w}</span></div>)}

        <Field label={t('Ref. by (type 2 letters)')} hint={<span className="muted">{t('Type “Self” if no doctor')}</span>}>
          <input className="input" list="doctors" data-nav data-testid="doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Self" />
          <datalist id="doctors">{docList.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
      </div>

      <div className="card col">
        <div className="row">
          <h2 className="grow">{t('Tests')}</h2>
          <input className="input" style={{ maxWidth: 260 }} placeholder={t('Find a test…')} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="test-filter" />
        </div>
        {!filter && bundles.length > 0 && (
          <div className="chips">
            {bundles.map((b) => (
              <button key={b.code} type="button" className={`chip${b.bundleCodes.every((c) => codes.has(c)) ? ' on' : ''}`} onClick={() => toggleBundle(b)}>{b.name}</button>
            ))}
          </div>
        )}
        {bySection.map(([sec, list]) => (
          <div key={sec} className="col" style={{ gap: 6 }}>
            <span className="muted" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '.08em' }}>{sec}</span>
            <div className="chips">
              {list.map((p) => (
                <button key={p.code} type="button" className={`chip${codes.has(p.code) ? ' on' : ''}`} onClick={() => toggle(p.code)} data-testid={`test-${p.code}`} aria-pressed={codes.has(p.code)}>
                  {p.name.replace(/ — sent out$/, '')} <small>{p.sentOut ? t('sent out') : ''} {p.price ? money(p.price) : ''}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!settings.pricesReviewed && <div className="muted" style={{ fontSize: 14 }}>{t('Prices are example rates — set the lab’s own in Settings.')}</div>}
      </div>

      <div className="card">
        <div className="grid4">
          <Field label={t('Discount (₹)')}><input className="input num" inputMode="numeric" data-nav value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={t('Paid now (₹)')}><input className="input num" inputMode="numeric" data-nav data-testid="paid" value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))} /></Field>
          <div className="stat"><div className="muted">{t('Total')}</div><div className="n" data-testid="total">{money(total)}</div></div>
          <div className="stat"><div className="muted">{t('Due')}</div><div className="n" style={{ color: total - paidN > 0 ? 'var(--eosin)' : undefined }}>{money(Math.max(0, total - paidN))}</div></div>
        </div>
      </div>

      <div className="row">
        <button className="btn big" disabled={!canSave || saving} onClick={save} data-testid="save-visit">
          {warnings.length && warnOk ? t('Save anyway') : t('Save & enter results')} →
        </button>
        {!canSave && <span className="muted">{needPhone ? t('Phone number is required.') : !ageGiven ? t('Enter the age.') : !name.trim() ? t('Enter the name.') : !sex ? t('Choose the sex.') : codes.size === 0 ? t('Tick at least one test.') : ''}</span>}
      </div>
    </div>
  )
}
