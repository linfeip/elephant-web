<template>
  <div>
    <a-space direction="vertical" style="width: 100%">
      <div style="display:flex; gap:8px; align-items:center">
        <a-select v-model:value="method" style="width: 120px">
          <a-select-option v-for="m in methods" :key="m" :value="m">{{ m }}</a-select-option>
        </a-select>
        <a-input v-model:value="url" placeholder="Enter URL" />
        <a-button type="primary" :loading="loading" @click="send">发送</a-button>
        <a-button @click="addToFlow">添加</a-button>
        <a-button type="dashed" @click="updateFlow" :disabled="!canUpdate">更新</a-button>
      </div>

      <a-card size="small" title="Headers">
        <div v-for="(h, idx) in headers" :key="idx" style="display:flex; gap:8px; margin-bottom:8px">
          <a-input v-model:value="h.key" placeholder="Header 名" style="width: 200px" />
          <a-input v-model:value="h.value" placeholder="Header 值" />
          <a-button danger type="text" @click="removeHeader(idx)">删除</a-button>
        </div>
        <a-button type="dashed" block @click="addHeader">+ 新增 Header</a-button>
      </a-card>

      <a-card size="small" title="Body">
        <a-segmented v-model:value="bodyMode" :options="['raw','json']" style="margin-bottom:8px" />
        <a-textarea v-model:value="bodyText" :auto-size="{minRows: 6, maxRows: 18}" placeholder="请求体（raw 或 JSON）" />
      </a-card>

      

      <a-card size="small" title="Response">
        <ResponseViewer :status-code="resp.status" :duration-ms="resp.durationMs" :headers="resp.headers" :body-text="resp.body" />
      </a-card>
    </a-space>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import axios from 'axios'
import ResponseViewer from './ResponseViewer.vue'

const props = defineProps({
  envMap: { type: Object, default: () => ({}) },
  canUpdate: { type: Boolean, default: false }
})
const emit = defineEmits(['add-to-flow','update-flow'])

const methods = ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS']
const method = ref('GET')
const url = ref('')

const headers = reactive([
  { key: 'Accept', value: 'application/json' }
])
const bodyMode = ref('raw')
const bodyText = ref('')

const loading = ref(false)
const resp = reactive({ status: null, durationMs: null, headers: {}, body: '' })

const addHeader = () => headers.push({ key: '', value: '' })
const removeHeader = (idx) => headers.splice(idx, 1)

const applyEnv = (u) => {
  return u.replace(/\{\{(.*?)\}\}/g, (_, k) => props.envMap[k.trim()] ?? '')
}

const send = async () => {
  loading.value = true
  resp.status = null
  resp.durationMs = null
  resp.headers = {}
  resp.body = ''
  const start = performance.now()
  try {
    const finalUrl = applyEnv(url.value)
    const hdrs = new Headers()
    headers.forEach(h => { if (h.key) hdrs.append(h.key, h.value) })
    const init = { method: method.value, headers: hdrs }
    const hasBody = !['GET','HEAD'].includes(method.value)
    if (hasBody && bodyText.value) {
      if (bodyMode.value === 'json') {
        init.body = bodyText.value
        if (!hdrs.has('Content-Type')) hdrs.set('Content-Type', 'application/json')
      } else {
        init.body = bodyText.value
      }
    }
    const r = await axios.request({
      url: finalUrl,
      method: method.value,
      headers: Object.fromEntries(hdrs.entries()),
      data: init.body,
      transformResponse: [(d) => d]
    })
    resp.status = r.status
    resp.headers = r.headers || {}
    resp.body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
    resp.durationMs = Math.round(performance.now() - start)
  } catch (e) {
    resp.status = 0
    resp.body = String(e)
    resp.durationMs = Math.round(performance.now() - start)
  } finally {
    loading.value = false
  }
}

const restore = (payload) => {
  method.value = payload.method
  url.value = payload.url
  while (headers.length) headers.pop()
  payload.headers.forEach(h => headers.push(h))
  bodyMode.value = payload.bodyMode
  bodyText.value = payload.bodyText
}

const addToFlow = () => {
  const finalUrl = applyEnv(url.value)
  emit('add-to-flow', {
    type: 'HTTP',
    title: `${method.value} ${finalUrl}`,
    payload: {
      method: method.value,
      url: url.value,
      headers: JSON.parse(JSON.stringify(headers)),
      bodyMode: bodyMode.value,
      bodyText: bodyText.value
    }
  })
}

const updateFlow = () => {
  const finalUrl = applyEnv(url.value)
  emit('update-flow', {
    type: 'HTTP',
    title: `${method.value} ${finalUrl}`,
    payload: {
      method: method.value,
      url: url.value,
      headers: JSON.parse(JSON.stringify(headers)),
      bodyMode: bodyMode.value,
      bodyText: bodyText.value
    }
  })
}

defineExpose({ restore })
</script>