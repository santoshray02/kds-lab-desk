/** Vitals taken at the front desk. All optional; blank means "not taken". Temperature is in °F, as used in Indian labs and clinics. */
export interface Vitals {
  heightCm: number | null
  weightKg: number | null
  bpSys: number | null
  bpDia: number | null
  pulse: number | null
  tempF: number | null
  spo2: number | null
}

export const NO_VITALS: Vitals = { heightCm: null, weightKg: null, bpSys: null, bpDia: null, pulse: null, tempF: null, spo2: null }

export const hasVitals = (v: Vitals): boolean => Object.values(v).some((x) => x != null)

/** Turns typed text into a number, or null when blank or not a number. */
export function toNum(s: string | number | null | undefined): number | null {
  if (s == null) return null
  const t = String(s).trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/** A plain-language problem with the vitals, or null when they are fine. Values that cannot be real are refused so a typing slip is caught. */
export function vitalsProblem(v: Vitals): string | null {
  const within = (x: number | null, lo: number, hi: number) => x == null || (Number.isFinite(x) && x >= lo && x <= hi)
  if (!within(v.heightCm, 30, 250)) return 'Height must be between 30 and 250 cm'
  if (!within(v.weightKg, 0.5, 300)) return 'Weight must be between 0.5 and 300 kg'
  if (!within(v.bpSys, 50, 260)) return 'Upper blood pressure (systolic) must be between 50 and 260'
  if (!within(v.bpDia, 30, 160)) return 'Lower blood pressure (diastolic) must be between 30 and 160'
  if ((v.bpSys == null) !== (v.bpDia == null)) return 'Enter both blood pressure numbers, or leave both blank'
  if (v.bpSys != null && v.bpDia != null && v.bpDia >= v.bpSys) return 'The lower blood pressure must be less than the upper one'
  if (!within(v.pulse, 20, 250)) return 'Pulse must be between 20 and 250 per minute'
  if (!within(v.tempF, 90, 110)) return 'Temperature must be between 90 and 110 °F'
  if (!within(v.spo2, 50, 100)) return 'Oxygen level (SpO₂) must be between 50 and 100 %'
  return null
}

/** Body mass index, only for adults (children need growth charts, which this program does not use). */
export function bmi(v: Vitals, ageYears: number): number | null {
  if (ageYears < 18 || v.heightCm == null || v.weightKg == null || v.heightCm <= 0) return null
  const m = v.heightCm / 100
  return Math.round((v.weightKg / (m * m)) * 10) / 10
}

export function bmiBand(b: number): string {
  return b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : 'Obese'
}

const trim = (n: number) => String(Math.round(n * 10) / 10)

/** One line for the screen and, when switched on, the printed report. */
export function vitalsLine(v: Vitals, ageYears: number): string {
  const parts: string[] = []
  if (v.heightCm != null) parts.push(`Height ${trim(v.heightCm)} cm`)
  if (v.weightKg != null) parts.push(`Weight ${trim(v.weightKg)} kg`)
  const b = bmi(v, ageYears)
  if (b != null) parts.push(`BMI ${b.toFixed(1)} (${bmiBand(b)})`)
  if (v.bpSys != null && v.bpDia != null) parts.push(`BP ${v.bpSys}/${v.bpDia} mmHg`)
  if (v.pulse != null) parts.push(`Pulse ${v.pulse}/min`)
  if (v.tempF != null) parts.push(`Temp ${trim(v.tempF)} °F`)
  if (v.spo2 != null) parts.push(`SpO₂ ${v.spo2}%`)
  return parts.join(' · ')
}
