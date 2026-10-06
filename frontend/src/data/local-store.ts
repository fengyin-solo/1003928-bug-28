import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedFallback(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedFallback()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const fallback = seedFallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    // 以持久化数据为准，未持久化过的模块回落到种子数据；单条字段的补齐交给业务层归一化。
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...seedFallback(), ...parsed }
  } catch {
    const fallback = seedFallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 不经过缓存、直接读取持久化最新值：跨标签页并发确认 / 退回时，
 * 状态机校验必须以这份为准（CAS），避免本页缓存被别的标签页抢先改掉后重复落库。
 */
export function freshRows(key: string): EntryRow[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return listRows(key)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return seedFallback()[key] ?? []
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return parsed[key] ?? seedFallback()[key] ?? []
  } catch {
    return listRows(key)
  }
}

/**
 * 原子提交：先序列化整库，再一次性写入 localStorage，最后才更新内存缓存。
 * beforeWrite 在真正写入之前执行，抛错则整体中止（不写入、不更新缓存），
 * 供业务层做乐观并发校验（OCC）。
 * 序列化或写入任一步失败都抛错，缓存保持原状，业务层据此整体退回，不允许半落库。
 */
export function commitRows(
  key: string,
  rows: EntryRow[],
  beforeWrite?: () => void,
): void {
  const next = { ...allRows(), [key]: rows }
  beforeWrite?.()
  const serialized = JSON.stringify(next) // 序列化失败（循环引用等）：缓存未动
  window.localStorage.setItem(STORAGE_KEY, serialized) // 写入失败（配额等）：缓存未动
  cache = next
}

export function saveRows(key: string, rows: EntryRow[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = { ...allRows(), [key]: rows }
    return
  }
  commitRows(key, rows)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 跨标签页写入后，本页缓存立即失效；下一次读取会走最新持久化值，并发动作再被状态机拦下。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function storageKey(): string {
  return STORAGE_KEY
}
