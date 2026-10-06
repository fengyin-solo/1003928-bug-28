<template>
  <section class="page" data-module="evacuation-detail">
    <header class="page-head">
      <div>
        <h2>搬迁安置户详情</h2>
        <p class="page-desc">户号 {{ row?.['户号'] ?? route.params.id }} 的登记信息、搬迁状态与安置确认记录。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回避险搬迁列表</button>
      </div>
    </header>

    <template v-if="row">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <dl class="detail-grid">
        <div v-for="field in fields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] || '—' }}</dd>
        </div>
        <div class="detail-item">
          <dt>当前状态</dt>
          <dd>{{ row.status }}</dd>
        </div>
        <div class="detail-item">
          <dt>确认人</dt>
          <dd>{{ row['确认人'] || '—' }}</dd>
        </div>
        <div class="detail-item">
          <dt>确认时间</dt>
          <dd>{{ row['确认时间'] || '—' }}</dd>
        </div>
      </dl>

      <p class="row-actions detail-actions">
        <button
          v-for="action in availableActions(row)"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </p>

      <section class="settlement-record">
        <h3>安置确认记录</h3>
        <table v-if="record" class="data-table">
          <thead>
            <tr><th>户号</th><th>安置地点</th><th>确认人</th><th>确认时间</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ record.户号 }}</td>
              <td>{{ record.安置地点 || '—' }}</td>
              <td>{{ record.确认人 }}</td>
              <td>{{ record.确认时间 || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-record">暂无安置确认记录，确认安置后按户号留档，历史安置地点不随后续改动。</p>
      </section>
    </template>
    <p v-else class="empty-state">没有找到该搬迁安置户，可能已被移除。</p>

    <div v-if="settlementOpen" class="dialog-mask">
      <form class="dialog" @submit.prevent="submitSettlement">
        <h3>确认安置 · 户号 {{ row?.['户号'] }}</h3>
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
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  confirmSettlement,
  evacuationStats,
  getEntry,
  getSettlement,
  moduleMeta,
  rowActions,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, SettlementRecord } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('evacuation')
const fields = ["户号", "所属隐患点", "户主姓名", "家庭人口", "原住址", "安置方式", "安置地点", "搬迁状态"]

const route = useRoute()
const router = useRouter()
const store = useSessionStore()
const row = ref<EntryRow | null>(null)
const record = ref<SettlementRecord | null>(null)
const errorMessage = ref('')
const stats = ref([
  { label: '需搬迁户数', value: 0 },
  { label: '已搬迁户数', value: 0 },
  { label: '已安置户数', value: 0 },
])
const settlementOpen = ref(false)
const settlementForm = ref({ 安置地点: '', 确认人: '' })
const settlementError = ref('')

function availableActions(target: EntryRow) {
  return rowActions(meta, target)
}

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push('/evacuation')
  }
}

function runAction(action: string) {
  errorMessage.value = ''
  if (!row.value) {
    return
  }
  if (action === '确认安置') {
    settlementError.value = ''
    settlementForm.value = {
      安置地点: String(row.value['安置地点'] ?? ''),
      确认人: store.operator,
    }
    settlementOpen.value = true
    return
  }
  const result = applyAction(meta.key, Number(row.value.id), action)
  // 无论成败都重读一次：并发下别的页签可能刚改过这一户。
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
  }
}

function closeSettlement() {
  settlementOpen.value = false
  settlementError.value = ''
}

function submitSettlement() {
  if (!row.value) {
    return
  }
  const result = confirmSettlement(Number(row.value.id), settlementForm.value)
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
  const current = getEntry(meta.key, Number(route.params.id))
  row.value = current
  record.value = current ? getSettlement(String(current['户号'] ?? '')) : null
  const summary = evacuationStats()
  stats.value = [
    { label: '需搬迁户数', value: summary.need },
    { label: '已搬迁户数', value: summary.moved },
    { label: '已安置户数', value: summary.settled },
  ]
}

onMounted(reload)
</script>
