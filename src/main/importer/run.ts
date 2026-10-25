import type { Db } from '../db'

export interface ImportProgress {
  done: number
  total: number
  file: string
}

export interface ImportSummary {
  total: number
  imported: number
  alreadyImported: number
  sentOut: number
  unparsed: number
}

export async function runImport(_db: Db, _folder: string, _progress: (p: ImportProgress) => void): Promise<ImportSummary> {
  throw new Error('not implemented yet')
}

export function importLog(_db: Db, _status?: string): { id: number; file: string; status: string; reason: string; run_at: string }[] {
  return []
}
