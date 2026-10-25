import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HI } from '../src/renderer/i18n'

function files(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) files(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('Hindi labels', () => {
  const used = new Set<string>()
  for (const f of files(join(__dirname, '..', 'src', 'renderer'))) {
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) used.add(m[1].replace(/\\'/g, "'"))
  }
  it('finds the screen strings', () => {
    expect(used.size).toBeGreaterThan(250)
  })
  it('every string used by a screen has a Hindi label', () => {
    const missing = [...used].filter((k) => !(k in HI))
    expect(missing).toEqual([])
  })
  it('Hindi labels are really Hindi (Devanagari) unless the term is a brand or code', () => {
    const latinOnly = Object.entries(HI).filter(([, v]) => !/[ऀ-ॿ]/.test(v))
    expect(latinOnly).toEqual([])
  })
})
