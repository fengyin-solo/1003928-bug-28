<template>
  <section class="page" data-module="evacuation-detail">
    <header class="page-head">
      <div>
        <h2>搬迁安置户详情 · {{ household?.户号 ?? '未找到' }}</h2>
        <p class="page-desc">按户号查看一户的搬迁流转全过程；确认安置时安置地点与确认人一次落库，退回保留当时地点。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/evacuation">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="!household" class="empty-state">
      没有找到户号为「{{ householdNo }}」的搬迁安置户，请从列表重新进入。
    </div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">
            {{ household.status }}
            <span v-if="household.abnormal" class="tag warn">异常流转</span>
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已安置户数（全口径）</span>
          <strong class="stat-value">{{ stats.resettled }} / {{ stats.total }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">所属隐患点安置进度</span>
          <strong class="stat-value">{{ hazardBucket ? `${hazardBucket.resettled}/${hazardBucket.total}` : '—' }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in infoFields" :key="field">
            <th>{{ field }}</th>
            <td :class="{ muted: field === '安置地点' && !household[field] }">
              <template v-if="field === '安置时间'">{{ formatTime(household.安置时间) }}</template>
              <template v-else>{{ household[field] === '' ? (field === '安置地点' ? '待确认' : '—') : household[field] }}</template>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 确认安置：已搬迁（含退回后重新确认）才出现；地点、确认人同时校验、同时落库。 -->
      <section v-if="household.status === '已搬迁'" class="action-panel">
        <h3>{{ household.安置地点 ? '重新确认安置' : '确认安置' }}</h3>
        <p v-if="household.安置地点" class="hint">
          该户曾退回安置：上次安置地点「{{ household.安置地点 }}」、确认人「{{ household.确认人 }}」已按当时保留，可沿用或修改。
        </p>
        <form class="confirm-form" @submit.prevent="submitConfirm">
          <label class="filter-item">
            <span>安置地点 *</span>
            <input v-model="confirmForm.安置地点" placeholder="如：青山镇集中安置点2栋1单元" />
          </label>
          <label class="filter-item">
            <span>安置方式</span>
            <select v-model="confirmForm.安置方式">
              <option value="集中安置">集中安置</option>
              <option value="分散安置">分散安置</option>
              <option value="货币安置">货币安置</option>
              <option value="投亲靠友">投亲靠友</option>
            </select>
          </label>
          <label class="filter-item">
            <span>确认人 *</span>
            <input v-model="confirmForm.确认人" placeholder="现场安置确认人" />
          </label>
          <button class="btn primary" type="submit" :disabled="busy">确认安置（一次落库）</button>
        </form>
      </section>

      <section v-else class="action-panel">
        <div class="action-row">
          <button v-if="household.status === '待动员'" class="btn primary" type="button" :disabled="busy" @click="doAction('sign')">签订协议</button>
          <button v-if="household.status === '已签约'" class="btn primary" type="button" :disabled="busy" @click="doAction('move')">完成搬迁</button>
          <button v-if="household.status === '已安置'" class="btn" type="button" :disabled="busy" @click="doAction('rollback')">退回安置</button>
          <p v-if="household.status === '已安置'" class="hint">
            退回后状态变为「已搬迁」，安置地点、确认人、安置时间按当时值保留；同一户并发确认与退回只允许一个动作成功。
          </p>
          <p v-else-if="household.status === '待动员' || household.status === '已签约'" class="hint">
            搬迁状态只能按 待动员 → 已签约 → 已搬迁 → 已安置 顺序推进，重复操作不会追加记录。
          </p>
        </div>
      </section>

      <section class="action-panel">
        <h3>搬迁流转记录</h3>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>动作</th><th>状态变化</th><th>安置地点</th><th>确认人</th><th>操作人</th></tr>
          </thead>
          <tbody>
            <tr v-for="(record, index) in household.搬迁操作记录" :key="index">
              <td>{{ formatTime(record.time) }}</td>
              <td>{{ record.action }}</td>
              <td>{{ record.from }} → {{ record.to }}</td>
              <td>{{ record.location ?? '—' }}</td>
              <td>{{ record.confirmer ?? '—' }}</td>
              <td>{{ record.operator }}</td>
            </tr>
            <tr v-if="!household.搬迁操作记录.length">
              <td colspan="6" class="empty-state">暂无流转记录</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="page-foot">
        <RouterLink class="link" to="/evacuation">← 返回避险搬迁列表</RouterLink>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  completeMove,
  confirmResettlement,
  evacuationStats,
  getHousehold,
  rollbackResettlement,
  signAgreement,
} from '@/api/local-service'
import { storageKey } from '@/data/local-store'
import type { EvacuationHousehold } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { formatTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const infoFields = ['户号', '所属隐患点', '户主姓名', '家庭人口', '原住址', '安置方式', '安置地点', '确认人', '安置时间']

const household = ref<EvacuationHousehold | null>(null)
const stats = ref(evacuationStats())
const errorMessage = ref('')
const successMessage = ref('')
const busy = ref(false)

const householdNo = computed(() => decodeURIComponent(String(route.params.householdNo ?? '')))
const hazardBucket = computed(() =>
  household.value
    ? stats.value.byHazard.find((item) => item.hazard === household.value?.所属隐患点)
    : undefined,
)

const confirmForm = reactive({ 安置地点: '', 安置方式: '集中安置', 确认人: '' })

function syncForm(current: EvacuationHousehold) {
  // 退回后重新确认：默认带出历史地点，确认人带当前值班人，可修改。
  confirmForm.安置地点 = current.安置地点 ?? ''
  confirmForm.安置方式 = current.安置方式 || '集中安置'
  confirmForm.确认人 = store.operator
}

function reload() {
  errorMessage.value = ''
  household.value = getHousehold(householdNo.value)
  stats.value = evacuationStats()
  if (household.value && household.value.status === '已搬迁') {
    syncForm(household.value)
  }
}

function submitConfirm() {
  if (!household.value) {
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  busy.value = true
  // 服务端式校验 + 原子提交：地点或确认人为空、状态已被并发改动、持久化失败，整体退回。
  const result = confirmResettlement(
    household.value.户号,
    {
      安置地点: confirmForm.安置地点,
      确认人: confirmForm.确认人,
      安置方式: confirmForm.安置方式,
    },
    store.operator,
  )
  busy.value = false
  if (!result.ok) {
    // 本地校验失败不 reload，保留用户已填的地点/确认人便于重试；
    // 跨标签页的并发变化由 storage 监听负责刷新。
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  router.replace({ path: route.path, query: {} })
  reload()
}

function doAction(kind: 'sign' | 'move' | 'rollback') {
  if (!household.value) {
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  busy.value = true
  const no = household.value.户号
  const result =
    kind === 'sign'
      ? signAgreement(no, store.operator)
      : kind === 'move'
        ? completeMove(no, store.operator)
        : rollbackResettlement(no, store.operator)
  busy.value = false
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    successMessage.value = result.message
  }
  reload()
}

function onStorage(event: StorageEvent) {
  if (event.key === storageKey()) {
    reload()
  }
}

watch(() => route.params.householdNo, reload)

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>
