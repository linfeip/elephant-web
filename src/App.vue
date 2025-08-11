<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider width="400" theme="light" style="border-right: 1px solid #f0f0f0">
      <div style="padding: 12px; font-weight: 600">环境变量</div>
      <!-- 环境变量编辑入口已移除，保留占位以便后续扩展 -->
      <div style="padding: 12px; font-weight: 600">gRPC Proto</div>
      <div style="padding: 12px">
        <a-space direction="vertical" style="width:100%">
          <a-upload
            v-model:file-list="protoFileList"
            multiple
            accept=".proto"
            :before-upload="onBeforeUploadProto"
            :on-remove="onRemoveProto"
            :custom-request="onCustomProtoRequest"
            :show-upload-list="{ showPreviewIcon: false, showDownloadIcon: false }"
            :item-render="uploadItemRender"
            list-type="text"
          >
            <a-button>选择 .proto</a-button>
          </a-upload>
          <div>
            <a-tag v-if="grpcServices.length" color="geekblue">已解析 {{ grpcServices.length }} 个 Service</a-tag>
            <a-tag v-else>未导入</a-tag>
          </div>
          <a-alert v-if="protoError" type="error" :message="protoError" show-icon />
        </a-space>
      </div>
      <div style="padding: 12px; font-weight: 600">压测流程配置</div>
      <div style="padding: 0 12px 12px">
        <a-empty v-if="flowTasks.length === 0" description="暂无流程任务，去右侧配置请求后点击(添加)" />
        <a-list v-else :data-source="flowTasks" size="small" style="max-height: 48vh; overflow: auto">
          <template #renderItem="{ item, index }">
            <a-list-item style="cursor: pointer; display:flex; align-items:center; gap:8px">
              <a-tag :color="item.type === 'HTTP' ? 'purple' : 'geekblue'">{{ item.type }}</a-tag>
              <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                @click="restoreFlowTask(item, index)">{{ index + 1 }}. {{ item.title }}</span>
              <a-button size="small" type="text" danger @click.stop="removeFlowTask(index)">删除</a-button>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <div style="padding: 12px; font-weight: 600">运行配置</div>
      <div style="padding: 12px">
        <a-space direction="vertical" style="width:100%">
          <div style="display:flex; gap:8px; align-items:center">
            <span>Robot 数：</span>
            <a-input-number v-model:value="robotNum" :min="1" style="width: 120px" />
            <a-button type="primary" :loading="running" :disabled="flowTasks.length === 0"
              @click="runFlow">运行</a-button>
            <a-button danger :disabled="!currentRunId" :loading="stopping" @click="onClickStop">停止</a-button>
          </div>
          <a-alert v-if="runResultMsg" :type="runOk ? 'success' : 'error'" :message="runResultMsg" show-icon />
        </a-space>
      </div>
    </a-layout-sider>

    <a-layout>
      <a-layout-header style="background: #fff; padding: 0 16px; border-bottom: 1px solid #f0f0f0">
        <div style="display: flex; align-items: center; gap: 12px">
          <span style="font-weight: 600">Elephant Web</span>
          <a-tag color="purple">HTTP</a-tag>
          <a-tag color="geekblue">gRPC</a-tag>
        </div>
      </a-layout-header>
      <a-layout-content style="padding: 12px; display:flex; flex-direction: column; height: calc(100vh - 64px);">
        <div style="flex: 1 1 auto; overflow: auto">
          <a-card size="small" title="配置任务">
            <a-tabs v-model:activeKey="activeTab">
              <a-tab-pane key="http" tab="HTTP">
                <HttpClient @add-to-flow="onAddToFlow" @update-flow="onUpdateFlow" :can-update="canUpdateHttp"
                  :env-map="envMap" ref="httpRef" />
              </a-tab-pane>
              <a-tab-pane key="grpc" tab="gRPC">
                <GrpcClient @add-to-flow="onAddToFlow" @update-flow="onUpdateFlow" :can-update="canUpdateGrpc"
                  :services="grpcServices" :proto-root="grpcProtoRoot" ref="grpcRef" />
              </a-tab-pane>
            </a-tabs>
          </a-card>
        </div>
        <div style="flex: 0 0 auto; margin-top: 12px">
          <a-card size="small" title="压测指标">
            <a-space style="margin-bottom: 8px" wrap>
              <a-tag v-if="currentRunId" color="blue">runId: {{ currentRunId }}</a-tag>
              <a-tag v-if="lastStatsUpdated" color="green">上次更新: {{ lastStatsUpdated }}</a-tag>
            </a-space>
            <a-table :data-source="metricsRows" :columns="metricsColumns" :pagination="false" size="small"
              row-key="key" />
          </a-card>
        </div>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch, h } from 'vue'
import { DeleteOutlined } from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'
import axios from 'axios'
import api from './lib/apiClient'
import HttpClient from './components/HttpClient.vue'
import GrpcClient from './components/GrpcClient.vue'
import { loadProtosFromMap, listServices } from './lib/protoLoader'

const activeTab = ref('http')

const envMap = reactive({})

const flowTasks = ref([])

// gRPC proto state (shared)
const grpcProtoRoot = ref(null)
const grpcServices = ref([])
const protoError = ref('')
const protoFileList = ref([])

// run config/state
const robotNum = ref(1)
const running = ref(false)
const runOk = ref(false)
const runResultMsg = ref('')
const stopping = ref(false)
// metrics table data + polling
const metricsRows = ref([])
const metricsColumns = [
  { title: '备注', dataIndex: 'name', key: 'name' },
  { title: 'P99', dataIndex: 'p99', key: 'p99' },
  { title: 'P90', dataIndex: 'p90', key: 'p90' },
  { title: 'P50', dataIndex: 'p50', key: 'p50' },
  { title: 'Count', dataIndex: 'count', key: 'count' },
  { title: 'QPS', dataIndex: 'qps', key: 'qps' }
]
const currentRunId = ref(null)
let statsTimer = null
const isPolling = ref(false)
const lastStatsUpdated = ref('')

// 环境变量 UI 已移除，保留 envMap 以兼容 HTTP 中 {{KEY}} 替换

const persistFlow = () => {
  localStorage.setItem('flow:tasks', JSON.stringify(flowTasks.value))
  localStorage.setItem('showDemo', '0')
}
const onAddToFlow = (item) => {
  flowTasks.value.push({ ...item, id: Date.now() + ':' + Math.random().toString(36).slice(2) })
  persistFlow()
}

const httpRef = ref(null)
const grpcRef = ref(null)
const selectedFlowIndex = ref(-1)

const restoreFlowTask = (item, idx) => {
  selectedFlowIndex.value = idx
  if (item.type === 'HTTP') {
    activeTab.value = 'http'
    httpRef.value?.restore?.(item.payload)
  } else if (item.type === 'gRPC') {
    activeTab.value = 'grpc'
    grpcRef.value?.restore?.(item.payload)
  }
}

const removeFlowTask = (idx) => {
  flowTasks.value.splice(idx, 1)
  persistFlow()
}

const clearFlow = () => {
  flowTasks.value = []
  persistFlow()
}

onMounted(() => {
  const showDemo = localStorage.getItem('showDemo')
  let showDemoFlag = showDemo != '0'
  const rawFlow = localStorage.getItem('flow:tasks')
  if (rawFlow) {
    try { flowTasks.value = JSON.parse(rawFlow) } catch { }
  }
  if (showDemoFlag && flowTasks.value.length === 0) {
    // Seed default HTTP GET tasks
    const defaults = [
      createDefaultHttpTask('http://47.99.126.118:8080/ping'),
      createDefaultHttpTask('http://47.99.126.118:8080/ping?delay=1'),
      createDefaultHttpTask('http://47.99.126.118:8080/testPost', `{"name": "test", "age": 1}`)
    ]
    flowTasks.value = defaults
    persistFlow()
  }
  // restore robot num
  const savedRobot = localStorage.getItem('run:robotNum')
  if (savedRobot) {
    const n = parseInt(savedRobot, 10)
    if (!Number.isNaN(n) && n > 0) robotNum.value = n
  }
  // Restore saved proto files
  const rawProto = localStorage.getItem('grpc:protoFiles')
  if (rawProto) {
    try {
      const saved = JSON.parse(rawProto)
      protoFileList.value = (saved || []).map((it, idx) => ({
        uid: `${Date.now()}_${idx}`,
        name: it.name,
        status: 'done',
        __content: it.content
      }))
      loadProtoFromUploadList()
    } catch { }
  }
})
// persist robot num
watch(robotNum, (v) => {
  try { localStorage.setItem('run:robotNum', String(v)) } catch {}
})
const canUpdateHttp = computed(() => selectedFlowIndex.value !== -1 && flowTasks.value[selectedFlowIndex.value]?.type === 'HTTP')
const canUpdateGrpc = computed(() => selectedFlowIndex.value !== -1 && flowTasks.value[selectedFlowIndex.value]?.type === 'gRPC')

const onUpdateFlow = (updated) => {
  if (selectedFlowIndex.value === -1) return
  const old = flowTasks.value[selectedFlowIndex.value]
  const title = updated.title || old.title
  const payload = updated.payload || old.payload
  const type = updated.type || old.type
  flowTasks.value[selectedFlowIndex.value] = { ...old, title, payload, type }
  persistFlow()
}

function persistProtoFiles(files) {
  const data = files.map(f => ({ name: f.name, content: f.__content }))
  localStorage.setItem('grpc:protoFiles', JSON.stringify(data))
}

const onBeforeUploadProto = async (file) => {
  try {
    const text = await file.text()
    file.__content = text
    // ensure uid exists
    if (!file.uid) file.uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    protoFileList.value = [...protoFileList.value, file]
    await loadProtoFromUploadList()
    persistProtoFiles(protoFileList.value)
  } catch (e) {
    protoError.value = '读取 proto 失败: ' + String(e)
  }
  return false
}

const onRemoveProto = async (file) => {
  protoFileList.value = protoFileList.value.filter(f => f.uid !== file.uid)
  await loadProtoFromUploadList()
  persistProtoFiles(protoFileList.value)
}

// prevent antd upload from making HTTP requests; read file locally
const onCustomProtoRequest = async (options) => {
  const { file, onSuccess, onError } = options
  try {
    // attach content and add to list
    const text = await file.text()
    file.__content = text
    if (!file.uid) file.uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    protoFileList.value = [...protoFileList.value, file]
    await loadProtoFromUploadList()
    persistProtoFiles(protoFileList.value)
    onSuccess && onSuccess({}, file)
  } catch (e) {
    onError && onError(e)
  }
}

// custom list item renderer to avoid anchor previews (which can trigger GET /filename)
const uploadItemRender = ({ file, actions }) => {
  return h('div', { style: 'display:flex; align-items:center; gap:8px;' }, [
    h('span', { style: 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, file.name),
    h(DeleteOutlined, {
      style: 'cursor:pointer; font-size:16px;',
      onClick: () => actions.remove()
    })
  ])
}

async function loadProtoFromUploadList() {
  protoError.value = ''
  const files = protoFileList.value
  if (!files.length) {
    grpcProtoRoot.value = null
    grpcServices.value = []
    return
  }
  try {
    const map = {}
    files.forEach(f => { map[f.name] = f.__content })
    const entryFiles = files.map(f => f.name)
    const root = await loadProtosFromMap(map, entryFiles)
    grpcProtoRoot.value = root
    grpcServices.value = listServices(root)
  } catch (err) {
    protoError.value = '解析 proto 失败: ' + String(err?.message || err)
  }
}

function serializeHttpArgs(payload) {
  // payload from HttpClient: { method, url, headers[], bodyMode, bodyText }
  const headersObj = {}
    ; (payload.headers || []).forEach(hdr => {
      if (hdr.key) headersObj[hdr.key] = hdr.value
    })
  return {
    url: payload.url,
    method: payload.method,
    headers: headersObj,
    body: payload.bodyText || '',
    bodyType: payload.bodyMode === 'json' ? 1 : 0
  }
}

function serializeGrpcArgs(payload) {
  // For now, pass through the chosen service/method and request JSON as string
  return {
    service: payload.service,
    method: payload.method,
    body: payload.requestJson || ''
  }
}

function createDefaultHttpTask(url, bodyText = '') {
  return {
    id: Date.now() + ':' + Math.random().toString(36).slice(2),
    type: 'HTTP',
    title: `GET ${url}`,
    payload: {
      method: 'GET',
      url,
      headers: [],
      bodyMode: 'raw',
      bodyText: ''
    }
  }
}

async function runFlow() {
  running.value = true
  runOk.value = false
  runResultMsg.value = ''
  try {
    const actions = flowTasks.value.map((t) => {
      if (t.type === 'HTTP') {
        const args = serializeHttpArgs(t.payload)
        return {
          action: 'http.call',
          data: JSON.stringify(args),
          timeout: "30s",
          loop: 1,
          comment: t.title
        }
      }
      if (t.type === 'gRPC') {
        const args = serializeGrpcArgs(t.payload)
        return {
          action: 'grpc.call',
          data: JSON.stringify(args),
          timeout: "30s",
          loop: 1,
          comment: t.title
        }
      }
      return null
    }).filter(Boolean)

    const body = {
      actions,
      robot: { num: robotNum.value }
    }

    const res = await api.post('/run', body)
    const rid = res.data
    runOk.value = res.status >= 200 && res.status < 300
    runResultMsg.value = runOk.value ? '提交成功' : `提交失败(${res.status})`

    runResultMsg.value += `: ${rid}`

    startStatsPolling(rid)

  } catch (e) {
    runOk.value = false
    runResultMsg.value = '请求异常: ' + String(e)
  } finally {
    running.value = false
  }
}

function clearMetrics() {
  metricsRows.value = []
}

function getStatsUrl(runId) {
  return `${api.defaults.baseURL}/stats/${encodeURIComponent(runId)}`
}

async function fetchStats(runId) {
  if (!runId) return
  try {
    const res = await api.get(`/stats/${encodeURIComponent(runId)}`)
    if (res.status < 200 || res.status >= 300) return
    const data = res.data
    const items = Array.isArray(data.items) ? data.items : []
    metricsRows.value = items.map((it, idx) => ({
      key: idx,
      name: it.name ?? '',
      p99: it.p99 ?? null,
      p90: it.p90 ?? null,
      p50: it.p50 ?? null,
      count: it.count ?? null,
      qps: it.qps ?? null
    }))
    lastStatsUpdated.value = new Date().toLocaleString()
  } catch (e) {
    // ignore transient errors
  }
}

function startStatsPolling(runId) {
  currentRunId.value = runId
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
  // fetch immediately then every 15s
  fetchStats(runId)
  statsTimer = setInterval(() => fetchStats(runId), 15000)
  isPolling.value = true
}

onBeforeUnmount(() => {
  if (statsTimer) clearInterval(statsTimer)
})

function stopPolling() {
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
  isPolling.value = false
}

function resumePolling() {
  if (!currentRunId.value || isPolling.value) return
  startStatsPolling(currentRunId.value)
}

function refreshStats() {
  if (currentRunId.value) fetchStats(currentRunId.value)
}

function onClickStop() {
  if (!currentRunId.value) return
  Modal.confirm({
    title: '确认停止当前压测?\nrunId: ' + currentRunId.value,
    okText: '停止',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        stopping.value = true
        await api.post(`/stop/${encodeURIComponent(currentRunId.value)}`)
        stopPolling()
        runResultMsg.value = '已发送停止指令'
      } catch (e) {
        runResultMsg.value = '停止失败: ' + String(e?.message || e)
      } finally {
        stopping.value = false
      }
    }
  })
}

</script>

<style>
html,
body,
#app {
  height: 100%;
}
</style>