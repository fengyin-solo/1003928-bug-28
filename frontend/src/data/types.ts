/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 避险搬迁一户一条的流转记录：安置地点、确认人随动作一次性留痕，退回也不删除。 */
export type EvacuationRecord = {
  action: '签订协议' | '完成搬迁' | '确认安置' | '退回安置'
  from: string
  to: string
  time: string
  operator: string
  /** 仅确认安置 / 退回安置时携带：退回时快照当时的安置地点，保证历史按当时地点保留。 */
  location?: string
  confirmer?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | EvacuationRecord[]
}

/** 避险搬迁安置户：户号是业务主键，安置地点、确认人、安置时间一次落库。 */
export type EvacuationHousehold = EntryRow & {
  户号: string
  所属隐患点: string
  户主姓名: string
  家庭人口: number | string
  原住址: string
  安置方式: string
  安置地点: string
  确认人: string
  安置时间: string
  搬迁操作记录: EvacuationRecord[]
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

/** 避险搬迁统计：列表、详情、运营概览、隐患点台账搬迁统计共用这一份结果。 */
export type EvacuationStats = {
  /** 需搬迁户数：全部登记户 */
  total: number
  /** 已签约户数：含已搬迁、已安置（签约后的累计口径） */
  signed: number
  /** 已搬迁户数：含已安置（搬迁后的累计口径） */
  moved: number
  /** 已安置户数：status === 已安置 */
  resettled: number
  /** 按所属隐患点编号归集，隐患点台账直接引用，保证两边数字一致 */
  byHazard: { hazard: string; total: number; moved: number; resettled: number }[]
}
