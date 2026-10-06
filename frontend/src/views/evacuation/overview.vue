<template>
  <section class="page" data-module="evacuation-overview">
    <header class="page-head">
      <div>
        <h2>避险搬迁安置概览</h2>
        <p class="page-desc">按户号与所属隐患点汇总搬迁进度；数字与避险搬迁列表、隐患点台账搬迁统计完全同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">重新统计</button>
        <RouterLink class="btn" to="/evacuation">进入搬迁列表</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">需搬迁户数</span>
        <strong class="stat-value">{{ stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已签约户数</span>
        <strong class="stat-value">{{ stats.signed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已搬迁户数</span>
        <strong class="stat-value">{{ stats.moved }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已安置户数</span>
        <strong class="stat-value">{{ stats.resettled }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <h3 class="section-title">按隐患点归集（与隐患点台账一致）</h3>
    <table class="data-table">
      <thead>
        <tr><th>所属隐患点编号</th><th>隐患点名称</th><th>需搬迁户数</th><th>已搬迁户数</th><th>已安置户数</th><th>安置完成率</th></tr>
      </thead>
      <tbody>
        <tr v-for="bucket in stats.byHazard" :key="bucket.hazard">
          <td>{{ bucket.hazard }}</td>
          <td>{{ hazardName(bucket.hazard) }}</td>
          <td>{{ bucket.total }}</td>
          <td>{{ bucket.moved }}</td>
          <td>{{ bucket.resettled }}</td>
          <td>{{ bucket.total === 0 ? '—' : `${Math.round((bucket.resettled / bucket.total) * 100)}%` }}</td>
        </tr>
        <tr v-if="!stats.byHazard.length">
          <td colspan="6" class="empty-state">暂无避险搬迁数据</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">最近安置 / 退回动态</h3>
    <table class="data-table">
      <thead>
        <tr><th>时间</th><th>户号</th><th>户主姓名</th><th>动作</th><th>状态变化</th><th>安置地点</th><th>确认人</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in recent" :key="`${item.户号}-${item.time}`">
          <td>{{ formatTime(item.time) }}</td>
          <td><RouterLink class="link" :to="`/evacuation/${encodeURIComponent(item.户号)}`">{{ item.户号 }}</RouterLink></td>
          <td>{{ item.户主姓名 }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.from }} → {{ item.to }}</td>
          <td>{{ item.location ?? '—' }}</td>
          <td>{{ item.confirmer ?? '—' }}</td>
        </tr>
        <tr v-if="!recent.length">
          <td colspan="7" class="empty-state">暂无安置动态</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { evacuationStats, listHouseholds } from '@/api/local-service'
import { listRows, storageKey } from '@/data/local-store'
import type { EvacuationHousehold, EvacuationStats } from '@/data/types'
import { formatTime } from '@/utils/format'

const statuses = ['待动员', '已签约', '已搬迁', '已安置', '拒绝搬迁']
const stats = ref<EvacuationStats>(evacuationStats())
const households = ref<EvacuationHousehold[]>([])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: households.value.filter((row) => row.status === status).length,
  })),
)

const hazardNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const row of listRows('hazard')) {
    map.set(String(row.隐患点编号 ?? ''), String(row.隐患点名称 ?? ''))
  }
  return map
})

function hazardName(code: string): string {
  return hazardNameMap.value.get(code) ?? '台账中未登记'
}

const recent = computed(() => {
  type Item = {
    time: string
    户号: string
    户主姓名: string
    action: string
    from: string
    to: string
    location?: string
    confirmer?: string
  }
  const items: Item[] = []
  for (const row of households.value) {
    for (const record of row.搬迁操作记录) {
      if (record.action === '确认安置' || record.action === '退回安置') {
        items.push({
          time: record.time,
          户号: row.户号,
          户主姓名: row.户主姓名,
          action: record.action,
          from: record.from,
          to: record.to,
          location: record.location,
          confirmer: record.confirmer,
        })
      }
    }
  }
  return items.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 10)
})

function reload() {
  stats.value = evacuationStats()
  households.value = listHouseholds()
}

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
