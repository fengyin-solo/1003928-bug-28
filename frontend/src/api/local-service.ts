import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitRows, freshRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  EvacuationHousehold,
  EvacuationRecord,
  EvacuationStats,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退回']

const EVACUATION_KEY = 'evacuation'

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

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === EVACUATION_KEY) {
    // 避险搬迁有自己的状态机（按户号定位、有序流转、安置确认一次落库），禁止走通用通道。
    return { ok: false, message: '避险搬迁请使用专项流转操作（签订协议 / 完成搬迁 / 确认安置 / 退回安置）' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  // 避险搬迁按归一化后的户数据导出，历史补录字段与列表看到的完全一致。
  const rows: EntryRow[] = key === EVACUATION_KEY ? (listHouseholds() as EntryRow[]) : listRows(key)
  for (const row of rows) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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

// ---------------------------------------------------------------------------
// 避险搬迁专项域：户号为业务主键；状态只能 待动员→已签约→已搬迁⇄已安置 单向推进、
// 已安置可退回已搬迁；安置地点与确认人在确认安置时一次性原子落库；统计全系统一份。
// ---------------------------------------------------------------------------

const EVACUATION_STATUSES = ['待动员', '已签约', '已搬迁', '已安置', '拒绝搬迁'] as const
const SIGNED_STATUSES = new Set(['已签约', '已搬迁', '已安置'])
const MOVED_STATUSES = new Set(['已搬迁', '已安置'])

const DEFAULT_OPERATOR = '值班管理员'

function isRecord(value: unknown): value is EvacuationRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.action === 'string' && typeof record.from === 'string' && typeof record.to === 'string'
}

/**
 * 读取路径归一化：本地持久化里可能是历史版本的户数据，这里统一补齐
 * 确认人 / 安置时间 / 操作记录，并让 pending 与权威状态对齐。
 * 已安置户缺安置地点时，从当时的确认安置留痕里恢复——历史已安置户按当时地点保留，不覆盖。
 */
export function normalizeHousehold(raw: EntryRow): EvacuationHousehold {
  const records = Array.isArray(raw.搬迁操作记录)
    ? (raw.搬迁操作记录 as unknown[]).filter(isRecord)
    : []
  const lastConfirm = [...records].reverse().find((record) => record.action === '确认安置')
  const status = EVACUATION_STATUSES.includes(raw.status as (typeof EVACUATION_STATUSES)[number])
    ? String(raw.status)
    : '待动员'
  return {
    ...raw,
    status,
    // 已安置即办结，其余状态都在流转中；不再依赖通用「最后一个状态」推断，避免已安置还算待处理。
    pending: status !== '已安置',
    abnormal: typeof raw.abnormal === 'boolean' ? raw.abnormal : false,
    户号: String(raw.户号 ?? ''),
    所属隐患点: String(raw.所属隐患点 ?? ''),
    户主姓名: String(raw.户主姓名 ?? ''),
    家庭人口: (raw.家庭人口 as number | string) ?? '',
    原住址: String(raw.原住址 ?? ''),
    安置方式: String(raw.安置方式 ?? ''),
    安置地点: String(raw.安置地点 ?? lastConfirm?.location ?? ''),
    确认人: String(raw.确认人 ?? lastConfirm?.confirmer ?? ''),
    安置时间: String(raw.安置时间 ?? lastConfirm?.time ?? ''),
    搬迁操作记录: records,
  }
}

export function listHouseholds(filters: Record<string, string> = {}): EvacuationHousehold[] {
  const households = listRows(EVACUATION_KEY).map(normalizeHousehold)
  // 户号是业务主键，输出按户号稳定排序，动作定位与行序号彻底脱钩。
  const sorted = [...households].sort((a, b) => a.户号.localeCompare(b.户号, 'zh-Hans-CN'))
  return filterRows(sorted, filters) as EvacuationHousehold[]
}

export function getHousehold(householdNo: string): EvacuationHousehold | null {
  const found = listRows(EVACUATION_KEY)
    .map(normalizeHousehold)
    .find((row) => row.户号 === householdNo)
  return found ?? null
}

/** 唯一统计口径：列表卡片、运营概览、隐患点台账搬迁统计都从这里取数。 */
export function evacuationStats(): EvacuationStats {
  const households = listRows(EVACUATION_KEY).map(normalizeHousehold)
  const byHazard = new Map<string, { hazard: string; total: number; moved: number; resettled: number }>()
  for (const row of households) {
    const hazard = row.所属隐患点 || '未归属隐患点'
    const bucket = byHazard.get(hazard) ?? { hazard, total: 0, moved: 0, resettled: 0 }
    bucket.total += 1
    if (MOVED_STATUSES.has(row.status as '已搬迁' | '已安置')) {
      bucket.moved += 1
    }
    if (row.status === '已安置') {
      bucket.resettled += 1
    }
    byHazard.set(hazard, bucket)
  }
  return {
    total: households.length,
    signed: households.filter((row) => SIGNED_STATUSES.has(row.status as '已签约' | '已搬迁' | '已安置')).length,
    moved: households.filter((row) => MOVED_STATUSES.has(row.status as '已搬迁' | '已安置')).length,
    resettled: households.filter((row) => row.status === '已安置').length,
    byHazard: [...byHazard.values()].sort((a, b) => a.hazard.localeCompare(b.hazard, 'zh-Hans-CN')),
  }
}

type TransitionPlan = {
  target: string
  abnormal?: boolean
  patch?: Partial<EvacuationHousehold>
  record: Omit<EvacuationRecord, 'from' | 'operator'>
}

// 同一户的进行中动作：同步流程内防止同页重入，跨标签页靠下面的 freshRows CAS。
const inFlight = new Set<string>()

function mutateHousehold(
  householdNo: string,
  operatorName: string,
  plan: (current: EvacuationHousehold, now: string) => TransitionPlan | { error: string },
): ActionResult {
  const operator = operatorName.trim() || DEFAULT_OPERATOR
  if (!householdNo) {
    return { ok: false, message: '缺少户号，无法定位搬迁安置户' }
  }
  if (inFlight.has(householdNo)) {
    return { ok: false, message: `户号 ${householdNo} 有动作正在提交，请勿重复操作` }
  }
  inFlight.add(householdNo)
  try {
    // 以持久化最新值做状态机校验（CAS 读）：别的标签页抢先确认/退回后，本动作立即失效。
    const persisted = freshRows(EVACUATION_KEY)
    const index = persisted.findIndex((row) => String(row.户号 ?? '') === householdNo)
    if (index < 0) {
      return { ok: false, message: `没有找到户号为 ${householdNo} 的搬迁安置户` }
    }
    const current = normalizeHousehold(persisted[index])
    const now = new Date().toISOString()
    const decided = plan(current, now)
    if ('error' in decided) {
      return { ok: false, message: decided.error }
    }

    const record: EvacuationRecord = {
      ...decided.record,
      from: current.status,
      operator,
    }
    // 安置地点、确认人、安置时间、状态、留痕在同一个对象里一次组装、一次落库。
    const updated: EvacuationHousehold = {
      ...current,
      ...decided.patch,
      status: decided.target,
      pending: decided.target !== '已安置',
      abnormal: decided.abnormal ?? current.abnormal,
      搬迁操作记录: [...current.搬迁操作记录, record],
    }
    const nextRows = persisted.map((row, rowIndex) => (rowIndex === index ? updated : row))
    // CAS 写：提交前再读一次持久化，确认这一户自本动作读取后未被并发动作改动。
    // 同一户并发「确认安置」与「退回安置」时，后写入者必在此失败，只有一个动作成功。
    const snapshot = JSON.stringify(persisted[index])
    try {
      commitRows(EVACUATION_KEY, nextRows, () => {
        const latest = freshRows(EVACUATION_KEY)
        const latestRow = latest.find((row) => String(row.户号 ?? '') === householdNo)
        if (!latestRow || JSON.stringify(latestRow) !== snapshot) {
          throw new Error('EVACUATION_CONCURRENT_MODIFICATION')
        }
      })
    } catch (error) {
      // 提交失败整体退回：不更新缓存、不留半截状态、不追加记录。
      if (error instanceof Error && error.message === 'EVACUATION_CONCURRENT_MODIFICATION') {
        return { ok: false, message: `户号 ${householdNo} 已被其他操作（确认安置 / 退回安置）抢先更新，本次动作未生效，请刷新后重试` }
      }
      return { ok: false, message: '本地持久化失败，本次操作已整体退回，请重试' }
    }
    return { ok: true, message: successMessage(decided.record.action, current, updated) }
  } finally {
    inFlight.delete(householdNo)
  }
}

function successMessage(action: EvacuationRecord['action'], before: EvacuationHousehold, after: EvacuationHousehold): string {
  if (action === '确认安置') {
    return `户号 ${after.户号} 已确认安置至「${after.安置地点}」，安置地点与确认人「${after.确认人}」已一次落库，状态「${before.status}→已安置」`
  }
  if (action === '退回安置') {
    return `户号 ${after.户号} 已退回安置，状态「已安置→已搬迁」；历史安置地点「${before.安置地点}」与确认记录保留备查`
  }
  return `户号 ${after.户号} 已${action}，状态「${before.status}→${after.status}」`
}

export function signAgreement(householdNo: string, operatorName = DEFAULT_OPERATOR): ActionResult {
  return mutateHousehold(householdNo, operatorName, (current, now) => {
    if (current.status === '已签约') {
      return { error: `户号 ${householdNo} 已签订协议，无需重复签订` }
    }
    if (current.status !== '待动员') {
      return { error: `户号 ${householdNo} 当前为「${current.status}」，不能签订协议（仅待动员户可签订）` }
    }
    return { target: '已签约', record: { action: '签订协议', to: '已签约', time: now } }
  })
}

export function completeMove(householdNo: string, operatorName = DEFAULT_OPERATOR): ActionResult {
  return mutateHousehold(householdNo, operatorName, (current, now) => {
    if (current.status === '已搬迁') {
      return { error: `户号 ${householdNo} 已完成搬迁，无需重复操作` }
    }
    if (current.status !== '已签约') {
      return { error: `户号 ${householdNo} 当前为「${current.status}」，不能完成搬迁（须先签订协议）` }
    }
    return { target: '已搬迁', record: { action: '完成搬迁', to: '已搬迁', time: now } }
  })
}

export function confirmResettlement(
  householdNo: string,
  payload: { 安置地点: string; 确认人: string; 安置方式?: string },
  operatorName = DEFAULT_OPERATOR,
): ActionResult {
  return mutateHousehold(householdNo, operatorName, (current, now) => {
    if (current.status === '已安置') {
      // 重复确认直接拒绝：状态不变、不追加记录、不覆盖当时地点。
      return { error: `户号 ${householdNo} 已安置，重复确认无效且不追加记录` }
    }
    if (current.status !== '已搬迁') {
      return { error: `户号 ${householdNo} 当前为「${current.status}」，不能确认安置（须先完成搬迁）` }
    }
    const location = payload.安置地点.trim()
    const confirmer = payload.确认人.trim()
    if (!location) {
      return { error: '确认安置必须填写安置地点，已整体退回未落库' }
    }
    if (!confirmer) {
      return { error: '确认安置必须填写确认人，已整体退回未落库' }
    }
    const patch: Partial<EvacuationHousehold> = {
      安置地点: location,
      确认人: confirmer,
      安置时间: now, // 与动作留痕同一时刻，安置地点/确认人/时间一起写入。
    }
    if (payload.安置方式 && payload.安置方式.trim()) {
      patch.安置方式 = payload.安置方式.trim()
    }
    return {
      target: '已安置',
      abnormal: false, // 安置确认办结，清掉历史退回留下的异常标记
      patch,
      record: { action: '确认安置', to: '已安置', time: now, location, confirmer },
    }
  })
}

export function rollbackResettlement(householdNo: string, operatorName = DEFAULT_OPERATOR): ActionResult {
  return mutateHousehold(householdNo, operatorName, (current, now) => {
    if (current.status !== '已安置') {
      // 并发场景：另一动作（确认/退回）已先行成功，这里拒绝第二个动作。
      return { error: `户号 ${householdNo} 当前为「${current.status}」，仅已安置户可退回安置` }
    }
    return {
      target: '已搬迁',
      abnormal: true,
      // 不回填安置相关字段：当前安置地点、确认人、安置时间按当时值保留。
      record: {
        action: '退回安置',
        to: '已搬迁',
        time: now,
        location: current.安置地点,
        confirmer: current.确认人,
      },
    }
  })
}

// ---------------------------------------------------------------------------

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = meta.key === EVACUATION_KEY
      ? (rows[meta.key] ?? []).map(normalizeHousehold)
      : rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
