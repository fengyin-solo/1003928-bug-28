import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  listSettlements,
  refreshFromStorage,
  resetRows,
  saveEntriesAndSettlement,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  EvacuationStats,
  HazardEvacuationStats,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SettlementRecord,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退回']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

function doneStatusesOf(meta: ModuleMeta): string[] {
  return meta.doneStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

/** 当前行可执行的动作：登记了前置状态的动作只在对应状态下出现。 */
export function rowActions(meta: ModuleMeta, row: EntryRow): string[] {
  return meta.actions.filter((action) => {
    const from = meta.actionFrom?.[action]
    return !from || String(row.status) === from
  })
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 以最新落库状态做判断：同一户在别处刚确认或退回过，这里后到的动作直接失败。
  refreshFromStorage()
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const from = meta.actionFrom?.[action]
  if (from && current !== from) {
    return { ok: false, message: `只有「${from}」的${meta.entity}才能${action}，当前为「${current}」` }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !doneStatusesOf(meta).includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (meta.statusField) {
    updated[meta.statusField] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function getSettlement(household: string): SettlementRecord | null {
  return listSettlements().find((record) => record.户号 === household) ?? null
}

export function listSettlementRecords(): SettlementRecord[] {
  return listSettlements()
}

/**
 * 确认安置：户号、安置地点、确认人、确认时间与状态一次落库，任一写失败整体退回。
 * 一户只留一条安置确认记录，重复确认不追加；历史记录里的安置地点保持当时值。
 */
export function confirmSettlement(
  id: number,
  input: { 安置地点: string; 确认人: string },
): ActionResult {
  const meta = moduleMeta('evacuation')
  const 安置地点 = input.安置地点.trim()
  const 确认人 = input.确认人.trim()
  if (!安置地点 || !确认人) {
    return { ok: false, message: '安置地点和确认人都要填写，才能确认安置' }
  }
  refreshFromStorage()
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === '已安置') {
    return { ok: false, message: `${meta.entity}已确认安置，重复确认不会追加安置记录` }
  }
  if (current !== '已搬迁') {
    return { ok: false, message: `只有「已搬迁」的${meta.entity}才能确认安置，当前为「${current}」` }
  }
  const 户号 = String(row['户号'] ?? '').trim()
  if (!户号) {
    return { ok: false, message: '该户缺少户号，无法登记安置确认记录' }
  }
  const updated: EntryRow = {
    ...row,
    status: '已安置',
    搬迁状态: '已安置',
    安置地点,
    确认人,
    确认时间: today(),
    pending: false,
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  // 历史已安置户按当时地点保留：已有记录的户不再追加新记录。
  const record: SettlementRecord | null = getSettlement(户号)
    ? null
    : { 户号, 安置地点, 确认人, 确认时间: String(updated['确认时间']) }
  try {
    saveEntriesAndSettlement(meta.key, next, record)
  } catch {
    return { ok: false, message: '安置确认落库失败，本次操作已整体退回，请重试' }
  }
  return { ok: true, message: `${meta.entity}已确认安置，安置地点「${安置地点}」` }
}

/** 避险搬迁统计：列表、详情、概览与隐患点台账共用同一口径，保证各处数字一致。 */
export function evacuationStats(rows: EntryRow[] = listRows('evacuation')): EvacuationStats {
  const active = rows.filter((row) => String(row.status) !== '拒绝搬迁')
  return {
    need: active.length,
    moved: active.filter((row) => ['已搬迁', '已安置'].includes(String(row.status))).length,
    settled: active.filter((row) => String(row.status) === '已安置').length,
  }
}

/** 按隐患点汇总的搬迁统计：台账外隐患点名下的户也单列，合计始终等于避险搬迁页的数字。 */
export function evacuationStatsByHazard(): HazardEvacuationStats[] {
  const hazards = listRows('hazard')
  const households = listRows('evacuation')
  const byHazard = new Map<string, EntryRow[]>()
  for (const row of households) {
    const code = String(row['所属隐患点'] ?? '')
    byHazard.set(code, [...(byHazard.get(code) ?? []), row])
  }
  const result: HazardEvacuationStats[] = hazards.map((hazard) => {
    const code = String(hazard['隐患点编号'] ?? '')
    return {
      隐患点编号: code,
      隐患点名称: String(hazard['隐患点名称'] ?? ''),
      ...evacuationStats(byHazard.get(code) ?? []),
    }
  })
  const known = new Set(result.map((item) => item.隐患点编号))
  for (const [code, grouped] of byHazard) {
    if (!known.has(code)) {
      result.push({
        隐患点编号: code || '未登记',
        隐患点名称: '（台账外隐患点）',
        ...evacuationStats(grouped),
      })
    }
  }
  return result
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const evacuation = evacuationStats(rows['evacuation'] ?? [])
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '需搬迁户数', value: evacuation.need },
    { label: '已搬迁户数', value: evacuation.moved },
    { label: '已安置户数', value: evacuation.settled },
  ]
  return { cards, modules }
}
