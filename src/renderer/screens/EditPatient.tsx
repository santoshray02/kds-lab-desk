import { useState } from 'react'
import { sexForTitle, TITLES } from '../../shared/age'
import type { Sex } from '../../shared/types'
import { api, Field, Modal, useApp } from '../ui'

interface P { id: number; name: string; title: string; sex: Sex; phone: string; village?: string }

const tenDigits = (v: string) => {
  const d = v.replace(/\D/g, '')
  return (d.length > 10 && d.startsWith('91') ? d.slice(2) : d).slice(0, 10)
}

/** One button that lets the desk correct a patient's name, title, sex, phone number or village. Asks for the PIN first when one is set. */
export function EditPatientButton({ patientId, onSaved, className = 'btn ghost' }: { patientId: number; onSaved: () => void; className?: string }) {
  const { t, askPin, guard } = useApp()
  const [form, setForm] = useState<{ p: P; pin: string } | null>(null)

  async function open() {
    const pin = (await api.settings.pinStatus()).ownerSet ? await askPin(t('PIN to edit patient details')) : ''
    if (pin === null) return
    const p = await guard(api.patients.get(patientId))
    if (p) setForm({ p: { ...p, village: p.village ?? '' }, pin })
  }

  return (
    <>
      <button className={className} onClick={open} data-testid="edit-patient">✎ {t('Edit details')}</button>
      {form && <EditForm p={form.p} pin={form.pin} onClose={(saved) => { setForm(null); if (saved) onSaved() }} />}
    </>
  )
}

function EditForm({ p, pin, onClose }: { p: P; pin: string; onClose: (saved: boolean) => void }) {
  const { t, guard, toast } = useApp()
  const [name, setName] = useState(p.name)
  const [title, setTitle] = useState(p.title)
  const [sex, setSex] = useState<Sex>(p.sex)
  const [phone, setPhone] = useState(p.phone)
  const [village, setVillage] = useState(p.village ?? '')
  const phoneOk = phone === '' || phone.length === 10
  const ok = name.trim().length > 1 && phoneOk

  async function save() {
    if (!ok) return
    const r = await guard(api.patients.update({ id: p.id, name: name.trim(), title, sex, phone, village }, pin || undefined))
    if (r !== undefined) { toast(t('Saved'), 'ok'); onClose(true) }
  }

  return (
    <Modal onClose={() => onClose(false)} wide>
      <h2>{t('Edit patient details')}</h2>
      <div className="col" style={{ gap: 12 }} onKeyDown={(e) => e.key === 'Enter' && save()}>
        <div className="grid3">
          <Field label={t('Title')}>
            <select className="input" value={title} onChange={(e) => { setTitle(e.target.value); const s = sexForTitle(e.target.value); if (s) setSex(s) }} data-testid="edit-title">
              {TITLES.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label={t('Name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-name" /></Field>
          <Field label={t('Sex')}>
            <select className="input" value={sex} onChange={(e) => setSex(e.target.value as Sex)} data-testid="edit-sex">
              <option value="M">{t('Male')}</option>
              <option value="F">{t('Female')}</option>
            </select>
          </Field>
        </div>
        <div className="grid2">
          <Field label={t('Mobile number')} hint={<span className="muted">{phoneOk ? t('Reports are sent on WhatsApp to this number.') : t('The number must have 10 digits.')}</span>}>
            <input className="input num" inputMode="numeric" value={phone} onChange={(e) => setPhone(tenDigits(e.target.value))} placeholder="98XXXXXXXX" data-testid="edit-phone" />
          </Field>
          <Field label={t('Village / place')}><input className="input" value={village} onChange={(e) => setVillage(e.target.value)} data-testid="edit-village" /></Field>
        </div>
        <div className="muted">{t('Changing the number changes it for this person only. Printed reports show the corrected details.')}</div>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => onClose(false)}>{t('Cancel')}</button>
        <button className="btn" disabled={!ok} onClick={save} data-testid="edit-save">{t('Save')}</button>
      </div>
    </Modal>
  )
}
