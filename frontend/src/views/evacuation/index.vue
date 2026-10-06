<template>
  <section class="page" data-module="evacuation">
    <header class="page-head">
      <div>
        <h2>避险搬迁管理</h2>
        <p class="page-desc">维护搬迁安置户，围绕户号、所属隐患点、户主姓名、家庭人口做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记搬迁安置户</button>
        <button class="btn" type="button" @click="exportRows">导出避险搬迁清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.户号">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '户号'" class="link" :to="detailRoute(row.户号)">{{ row[column] ?? '—' }}</RouterLink>
            <template v-else>{{ displayValue(column, row) }}</template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="tag warn" title="存在退回等异常流转">异常</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="detailRoute(row.户号)">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无避险搬迁数据，可先登记搬迁安置户</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条避险搬迁记录 · 统计与隐患点台账、运营概览同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  completeMove,
  downloadEntries,
  evacuationStats,
  listHouseholds,
  moduleMeta,
  rollbackResettlement,
  signAgreement,
} from '@/api/local-service'
import { storageKey } from '@/data/local-store'
import type { EvacuationHousehold } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { formatTime } from '@/utils/format'

const meta = moduleMeta('evacuation')
// 搬迁状态以统一的「当前状态」列为准，不再保留与权威状态重复的「搬迁状态」业务列。
const columns = ["户号", "所属隐患点", "户主姓名", "家庭人口", "原住址", "安置方式", "安置地点"]
const statuses = ["待动员", "已签约", "已搬迁", "已安置", "拒绝搬迁"]

const router = useRouter()
const store = useSessionStore()
const rows = ref<EvacuationHousehold[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = ref(evacuationStats())
const statCards = computed(() => [
  { label: '需搬迁户数', value: stats.value.total },
  { label: '已搬迁户数', value: stats.value.moved },
  { label: '已安置户数', value: stats.value.resettled },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function detailRoute(householdNo: string) {
  return `/evacuation/${encodeURIComponent(householdNo)}`
}

function displayValue(column: string, row: EvacuationHousehold): string {
  if (column === '安置地点' && !row.安置地点) {
    return '待确认'
  }
  if (column === '安置时间') {
    return formatTime(row.安置时间)
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

/** 状态机：动作按当前状态出现，列表上不再允许串位点击。 */
function availableActions(row: EvacuationHousehold): string[] {
  switch (row.status) {
    case '待动员':
      return ['签订协议']
    case '已签约':
      return ['完成搬迁']
    case '已搬迁':
      return ['确认安置']
    case '已安置':
      return ['退回安置']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '搬迁安置户登记入口尚未接入审批流'
}

function runAction(action: string, row: EvacuationHousehold) {
  errorMessage.value = ''
  successMessage.value = ''
  // 确认安置需要采集安置地点、确认人，统一到详情页一次填写、一次落库。
  if (action === '确认安置') {
    router.push(detailRoute(row.户号))
    return
  }
  const result =
    action === '签订协议'
      ? signAgreement(row.户号, store.operator)
      : action === '完成搬迁'
        ? completeMove(row.户号, store.operator)
        : rollbackResettlement(row.户号, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listHouseholds(filters.value)
    total.value = rows.value.length
    stats.value = evacuationStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '避险搬迁列表读取失败'
  }
}

// 其他标签页并发确认 / 退回后，本页立即按最新持久化值重算，避免展示旧状态。
function onStorage(event: StorageEvent) {
  if (event.key === storageKey()) {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>
