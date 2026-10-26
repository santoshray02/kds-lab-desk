import { bmi, bmiBand, toNum, vitalsProblem, type Vitals } from '../../shared/vitals'
import { Field, useApp } from '../ui'

/** The vitals as typed (text), so a half-typed number is never lost. */
export interface VitalsText { h: string; w: string; sys: string; dia: string; pulse: string; temp: string; spo2: string }
export const EMPTY_VITALS_TEXT: VitalsText = { h: '', w: '', sys: '', dia: '', pulse: '', temp: '', spo2: '' }

const s = (n: number | null) => (n == null ? '' : String(n))
export const textOf = (v: Vitals): VitalsText => ({ h: s(v.heightCm), w: s(v.weightKg), sys: s(v.bpSys), dia: s(v.bpDia), pulse: s(v.pulse), temp: s(v.tempF), spo2: s(v.spo2) })
export const vitalsOf = (x: VitalsText): Vitals => ({ heightCm: toNum(x.h), weightKg: toNum(x.w), bpSys: toNum(x.sys), bpDia: toNum(x.dia), pulse: toNum(x.pulse), tempF: toNum(x.temp), spo2: toNum(x.spo2) })

const dec = (v: string, max = 6) => v.replace(/[^\d.]/g, '').slice(0, max)
const int = (v: string, max = 3) => v.replace(/\D/g, '').slice(0, max)

export function VitalsFields({ value, onChange, ageYears }: { value: VitalsText; onChange: (v: VitalsText) => void; ageYears: number }) {
  const { t } = useApp()
  const set = (k: keyof VitalsText, v: string) => onChange({ ...value, [k]: v })
  const parsed = vitalsOf(value)
  const problem = vitalsProblem(parsed)
  const b = bmi(parsed, ageYears)
  return (
    <div className="col" style={{ gap: 12 }} data-testid="vitals-fields">
      <div className="grid4">
        <Field label={t('Height (cm)')}><input className="input num" inputMode="decimal" data-nav data-testid="vit-height" value={value.h} onChange={(e) => set('h', dec(e.target.value))} /></Field>
        <Field label={t('Weight (kg)')}><input className="input num" inputMode="decimal" data-nav data-testid="vit-weight" value={value.w} onChange={(e) => set('w', dec(e.target.value))} /></Field>
        <Field label={t('Blood pressure (upper)')}><input className="input num" inputMode="numeric" data-nav data-testid="vit-sys" value={value.sys} onChange={(e) => set('sys', int(e.target.value))} placeholder="120" /></Field>
        <Field label={t('Blood pressure (lower)')}><input className="input num" inputMode="numeric" data-nav data-testid="vit-dia" value={value.dia} onChange={(e) => set('dia', int(e.target.value))} placeholder="80" /></Field>
      </div>
      <div className="grid4">
        <Field label={t('Pulse (per minute)')}><input className="input num" inputMode="numeric" data-nav data-testid="vit-pulse" value={value.pulse} onChange={(e) => set('pulse', int(e.target.value))} /></Field>
        <Field label={t('Temperature (°F)')}><input className="input num" inputMode="decimal" data-nav data-testid="vit-temp" value={value.temp} onChange={(e) => set('temp', dec(e.target.value, 5))} /></Field>
        <Field label={t('Oxygen level SpO₂ (%)')}><input className="input num" inputMode="numeric" data-nav data-testid="vit-spo2" value={value.spo2} onChange={(e) => set('spo2', int(e.target.value))} /></Field>
        <Field label="BMI">
          <div className="input num" style={{ display: 'flex', alignItems: 'center' }} data-testid="vit-bmi">
            {b != null ? <span><b>{b.toFixed(1)}</b> <span className="muted">{t(bmiBand(b))}</span></span> : <span className="muted">{ageYears < 18 ? t('adults only') : '—'}</span>}
          </div>
        </Field>
      </div>
      {problem && <div className="alert warn" data-testid="vit-problem"><b>⚠</b><span>{t(problem)}</span></div>}
    </div>
  )
}
