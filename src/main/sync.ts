import type { Db } from './db'

export function syncStatus(_db: Db): unknown {
  return { enabled: false }
}
export async function syncNow(_db: Db, _dataDir: string): Promise<unknown> {
  return { enabled: false }
}
export async function testConnection(_url: string, _key: string): Promise<unknown> {
  return { ok: false }
}
export function startSyncLoop(_db: Db, _dataDir: string): void {}
