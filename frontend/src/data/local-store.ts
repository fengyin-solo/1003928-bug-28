import { SEED_ROWS } from './seed'
import type { EntryRow, SettlementRecord } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 搬迁台账与安置确认记录分两个键存放，确认安置时两个键一次落库，任一失败整体退回。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const SETTLEMENTS_KEY = 'geohazard-monitor-prevention:settlements'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!storageAvailable()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

// 安置确认记录按户号归集，一户一条。老数据没有这个键时，从已安置户的台账行迁移，
// 安置地点、确认人按当时台账里的值保留，不用种子数据覆盖。
function readSettlements(): SettlementRecord[] {
  if (!storageAvailable()) {
    return deriveSettlements(allRows())
  }
  const raw = window.localStorage.getItem(SETTLEMENTS_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as SettlementRecord[]
    } catch {
      window.localStorage.removeItem(SETTLEMENTS_KEY)
    }
  }
  const derived = deriveSettlements(allRows())
  window.localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify(derived))
  return derived
}

function deriveSettlements(entries: Record<string, EntryRow[]>): SettlementRecord[] {
  const rows = entries['evacuation'] ?? []
  return rows
    .filter((row) => String(row.status) === '已安置' && String(row['户号'] ?? '') !== '')
    .map((row) => ({
      户号: String(row['户号']),
      安置地点: String(row['安置地点'] ?? ''),
      确认人: String(row['确认人'] ?? '历史登记'),
      确认时间: String(row['确认时间'] ?? ''),
    }))
}

let cache: Record<string, EntryRow[]> | null = null
let settlementsCache: SettlementRecord[] | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function listSettlements(): SettlementRecord[] {
  if (settlementsCache === null) {
    settlementsCache = readSettlements()
  }
  return settlementsCache
}

// 改数据之前先重新读一遍已提交的存储：别的页签刚做过的确认/退回能立刻看到，
// 同一户的并发动作里只有先落库的那个能成功。
export function refreshFromStorage(): void {
  cache = readStorage()
  settlementsCache = readSettlements()
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (storageAvailable()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

// 确认安置的落库：搬迁台账与安置确认记录一起写，任何一步失败都恢复到写之前的快照，
// 不会出现状态已是已安置但安置地点、确认人没存上的半截数据。
export function saveEntriesAndSettlement(
  key: string,
  rows: EntryRow[],
  record: SettlementRecord | null,
): void {
  const nextEntries = { ...allRows(), [key]: rows }
  const nextSettlements = record ? [...listSettlements(), record] : [...listSettlements()]
  if (!storageAvailable()) {
    cache = nextEntries
    settlementsCache = nextSettlements
    return
  }
  const prevEntriesRaw = window.localStorage.getItem(STORAGE_KEY)
  const prevSettlementsRaw = window.localStorage.getItem(SETTLEMENTS_KEY)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries))
    window.localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify(nextSettlements))
  } catch (error) {
    restoreKey(STORAGE_KEY, prevEntriesRaw)
    restoreKey(SETTLEMENTS_KEY, prevSettlementsRaw)
    cache = null
    settlementsCache = null
    throw error
  }
  cache = nextEntries
  settlementsCache = nextSettlements
}

function restoreKey(key: string, raw: string | null): void {
  try {
    if (raw === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, raw)
    }
  } catch {
    // 恢复失败时缓存已清空，下次读取会重新落一份一致的数据。
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function settlementsStorageKey(): string {
  return SETTLEMENTS_KEY
}

// 别的页签改了本地数据时丢掉缓存，下次读取以最新落库内容为准。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      cache = null
    }
    if (event.key === null || event.key === SETTLEMENTS_KEY) {
      settlementsCache = null
    }
  })
}
