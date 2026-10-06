/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 业务状态字段名：动作流转时与系统 status 一起同步，避免列表里状态串位。 */
  statusField?: string
  /** 动作的前置状态：不在该状态时不允许执行，并发下后到的动作直接失败。 */
  actionFrom?: Record<string, string>
  /** 终态（不再待处理）的状态集合；缺省取 statuses 最后一项。 */
  doneStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 安置确认记录：按户号一户一条，确认时落库，历史地点不随后续改动。 */
export type SettlementRecord = {
  户号: string
  安置地点: string
  确认人: string
  确认时间: string
}

export type EvacuationStats = {
  /** 需搬迁户数：除拒绝搬迁外的全部登记户。 */
  need: number
  /** 已搬迁户数：已完成搬迁（含已安置）的户数。 */
  moved: number
  /** 已安置户数：已确认安置的户数。 */
  settled: number
}

export type HazardEvacuationStats = EvacuationStats & {
  隐患点编号: string
  隐患点名称: string
}
