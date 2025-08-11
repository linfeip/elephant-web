<template>
  <div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px">
      <a-tag v-if="statusCode" :color="statusColor">{{ statusCode }}</a-tag>
      <a-tag v-if="durationMs !== null">{{ durationMs }} ms</a-tag>
      <a-tag v-if="contentType">{{ contentType }}</a-tag>
      <a-tag v-if="contentLength !== null">{{ contentLength }} B</a-tag>
    </div>
    <a-tabs>
      <a-tab-pane key="headers" tab="Headers">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item v-for="(val, key) in headers" :key="key" :label="key">{{ val }}</a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>
      <a-tab-pane key="body" tab="Body">
        <a-segmented v-model:value="viewMode" :options="['raw','pretty']" style="margin-bottom:8px" />
        <a-empty v-if="!bodyText" description="无响应内容" />
        <pre v-else-if="viewMode==='raw'" style="max-height: 50vh; overflow: auto; background:#0b1020; color:#e6e6e6; padding:12px">{{ bodyText }}</pre>
        <pre v-else style="max-height: 50vh; overflow: auto; background:#0b1020; color:#e6e6e6; padding:12px">{{ prettyText }}</pre>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  statusCode: { type: Number, default: null },
  durationMs: { type: Number, default: null },
  headers: { type: Object, default: () => ({}) },
  bodyText: { type: String, default: '' }
})

const viewMode = ref('pretty')
const contentType = computed(() => props.headers['content-type'] || props.headers['Content-Type'] || '')
const contentLength = computed(() => {
  const v = props.headers['content-length'] || props.headers['Content-Length']
  return v ? Number(v) : null
})
const statusColor = computed(() => {
  const code = props.statusCode || 0
  if (code >= 200 && code < 300) return 'green'
  if (code >= 300 && code < 400) return 'blue'
  if (code >= 400 && code < 500) return 'orange'
  if (code >= 500) return 'red'
  return 'default'
})

const prettyText = computed(() => {
  const ct = contentType.value
  if (ct && ct.includes('application/json')) {
    try { return JSON.stringify(JSON.parse(props.bodyText), null, 2) } catch { return props.bodyText }
  }
  return props.bodyText
})
</script>