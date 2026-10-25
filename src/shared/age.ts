import type { AgeInput, Sex } from './types'

export function ageToDays(a: AgeInput): number {
  return Math.round(a.years * 365.25 + a.months * 30.44 + a.days)
}

export function formatAge(a: AgeInput): string {
  if (a.years > 0) return `${a.years} ${a.years === 1 ? 'Year' : 'Years'}`
  if (a.months > 0) return `${a.months} ${a.months === 1 ? 'Month' : 'Months'}`
  return `${a.days} ${a.days === 1 ? 'Day' : 'Days'}`
}

export function formatAgeShort(a: AgeInput): string {
  if (a.years > 0) return `${a.years} Y`
  if (a.months > 0) return `${a.months} M`
  return `${a.days} D`
}

export const TITLES = ['Mr', 'Mrs', 'Miss', 'Master', 'Baby'] as const
export type Title = (typeof TITLES)[number]

export function sexForTitle(title: string): Sex | null {
  switch (title) {
    case 'Mr':
    case 'Master':
      return 'M'
    case 'Mrs':
    case 'Miss':
      return 'F'
    default:
      return null // Baby: sex has to be chosen
  }
}

export function sexLabel(sex: Sex): string {
  return sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Other'
}

/** Warnings when title, sex and age do not fit each other. */
export function titleChecks(title: string, sex: Sex, age: AgeInput): string[] {
  const out: string[] = []
  const fixed = sexForTitle(title)
  if (fixed && fixed !== sex) {
    out.push(`Title "${title}." does not match sex ${sexLabel(sex)}.`)
  }
  const years = age.years + age.months / 12
  if (title === 'Master' && years >= 18) out.push('"Master" is used for boys; age is 18 or more.')
  if (title === 'Baby' && years >= 5) out.push('"Baby" is used for infants; age is 5 or more.')
  if ((title === 'Mrs' || title === 'Mr') && years < 14 && years > 0) {
    out.push(`"${title}." with age under 14 — please check the age.`)
  }
  if (age.years === 0 && age.months === 0 && age.days === 0) {
    out.push('Age is not filled in; child/adult ranges cannot be chosen.')
  }
  return out
}

export function parseSampleSeq(sampleId: string): { yymm: string; n: number } | null {
  const m = /^(\d{4})-(\d{3,})$/.exec(sampleId)
  return m ? { yymm: m[1], n: parseInt(m[2], 10) } : null
}

/** Next sample ID of the form YYMM-NNN for the month of `date`, given existing IDs. */
export function nextSampleId(date: Date, existing: string[]): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const prefix = `${yy}${mm}`
  let max = 0
  for (const id of existing) {
    const p = parseSampleSeq(id)
    if (p && p.yymm === prefix && p.n > max) max = p.n
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}
