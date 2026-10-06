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
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
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
            <RouterLink class="link" :to="`/evacuation/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无避险搬迁数据，可先登记搬迁安置户</td>
        </tr>
      </tbody>
    </table>

    <div v-if="settlementTarget" class="dialog-mask">
      <form class="dialog" @submit.prevent="submitSettlement">
        <h3>确认安置 · 户号 {{ settlementTarget['户号'] }}</h3>
        <label class="dialog-field">
          <span>安置地点</span>
          <input v-model="settlementForm.安置地点" placeholder="填写安置地点" required />
        </label>
        <label class="dialog-field">
          <span>确认人</span>
          <input v-model="settlementForm.确认人" placeholder="填写确认人" required />
        </label>
        <p class="dialog-tip">安置地点与确认人随确认一次落库；任一写失败，本次确认整体退回。</p>
        <div class="dialog-actions">
          <button class="btn primary" type="submit">确认安置</button>
          <button class="btn ghost" type="button" @click="closeSettlement">取消</button>
        </div>
        <p v-if="settlementError" class="error-text">{{ settlementError }}</p>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条避险搬迁记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmSettlement,
  downloadEntries,
  evacuationStats,
  listEntries,
  moduleMeta,
  rowActions,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('evacuation')
const columns = ["户号", "所属隐患点", "户主姓名", "家庭人口", "原住址", "安置方式", "安置地点", "搬迁状态"]
const statuses = ["待动员", "已签约", "已搬迁", "已安置", "拒绝搬迁"]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = ref([
  { label: '需搬迁户数', value: 0 },
  { label: '已搬迁户数', value: 0 },
  { label: '已安置户数', value: 0 },
])
const settlementTarget = ref<EntryRow | null>(null)
const settlementForm = ref({ 安置地点: '', 确认人: '' })
const settlementError = ref('')
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function availableActions(row: EntryRow) {
  return rowActions(meta, row)
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '确认安置') {
    settlementError.value = ''
    settlementTarget.value = row
    settlementForm.value = {
      安置地点: String(row['安置地点'] ?? ''),
      确认人: store.operator,
    }
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  // 无论成败都重读一次：并发下别的页签可能刚改过这一户。
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
  }
}

function closeSettlement() {
  settlementTarget.value = null
  settlementError.value = ''
}

function submitSettlement() {
  if (!settlementTarget.value) {
    return
  }
  const result = confirmSettlement(Number(settlementTarget.value.id), settlementForm.value)
  if (!result.ok) {
    settlementError.value = result.message
    reload()
    return
  }
  closeSettlement()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const summary = evacuationStats()
    stats.value = [
      { label: '需搬迁户数', value: summary.need },
      { label: '已搬迁户数', value: summary.moved },
      { label: '已安置户数', value: summary.settled },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '避险搬迁列表读取失败'
  }
}

onMounted(reload)
</script>
