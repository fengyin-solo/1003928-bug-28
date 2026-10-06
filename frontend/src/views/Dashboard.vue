<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="cross-stat">
      <h3 class="section-title">避险搬迁安置概览（与避险搬迁列表、详情、隐患点台账同源）</h3>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">需搬迁户数</span>
          <strong class="stat-value">{{ evacuation.total }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已签约户数</span>
          <strong class="stat-value">{{ evacuation.signed }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已搬迁户数</span>
          <strong class="stat-value">{{ evacuation.moved }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已安置户数</span>
          <strong class="stat-value">{{ evacuation.resettled }}</strong>
        </article>
      </div>
      <p>
        <RouterLink class="link" to="/evacuation/overview">查看避险搬迁安置概览 →</RouterLink>
      </p>
    </section>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { evacuationStats, loadOverview } from '@/api/local-service'
import { storageKey } from '@/data/local-store'
import type { EvacuationStats, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const evacuation = ref<EvacuationStats>(evacuationStats())

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  evacuation.value = evacuationStats()
}

function onStorage(event: StorageEvent) {
  if (event.key === storageKey()) {
    refresh()
  }
}

onMounted(() => {
  refresh()
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>
