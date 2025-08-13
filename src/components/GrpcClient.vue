<template>
  <div>
    <a-alert type="info" message="从左侧导入 .proto 后，选择 Service/Method，填写请求地址并发送。" show-icon style="margin-bottom:8px" />

    

    <div>
      <a-card size="small" title="调用信息">
        <a-space direction="vertical" style="width:100%">
          <a-input v-model:value="endpointUrl" placeholder="请求地址，例如：127.0.0.1:8090" />
          <a-select v-model:value="selectedService" placeholder="请选择 Service" style="width: 100%" :disabled="!services.length">
            <a-select-option v-for="s in services" :key="s.fullName" :value="s.fullName">{{ s.fullName }}</a-select-option>
          </a-select>
          <a-select v-model:value="selectedMethod" placeholder="请选择 Method" style="width: 100%" :disabled="!availableMethods.length">
            <a-select-option v-for="m in availableMethods" :key="m.name" :value="m.name">{{ m.name }}</a-select-option>
          </a-select>
          <a-textarea v-model:value="requestJson" :auto-size="{minRows:6, maxRows:18}" placeholder='{"name":"world"}' />
          <a-space>
            <a-button type="primary" :loading="loading" @click="sendRequest">发送</a-button>
            <a-button @click="addToFlow">添加</a-button>
            <a-button type="dashed" @click="updateFlow" :disabled="!canUpdate">更新</a-button>
          </a-space>
        </a-space>
      </a-card>

      <a-card size="small" title="Response" style="margin-top:8px">
        <ResponseViewer :status-code="resp.status" :duration-ms="resp.durationMs" :headers="resp.headers" :body-text="resp.body" />
      </a-card>
    </div>

    
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import api from '../lib/apiClient'
import ResponseViewer from './ResponseViewer.vue'
import { makeDefaultMessageJson } from '../lib/protoLoader'

const props = defineProps({
  services: { type: Array, default: () => [] },
  protoRoot: { type: Object, default: null },
  canUpdate: { type: Boolean, default: false }
})
const emit = defineEmits(['add-to-flow','update-flow'])

const service = ref('')
const method = ref('')
const requestJson = ref('')
const endpointUrl = ref('')

const loading = ref(false)
const resp = reactive({ status: null, durationMs: null, headers: {}, body: '' })

const services = computed(() => props.services || [])
const selectedService = ref(null)
const selectedMethod = ref(null)
const suppressAutoFill = ref(false)
const lastRestoredService = ref(null)
const lastRestoredMethod = ref(null)

const availableMethods = computed(() => {
  const svc = services.value.find(s => s.fullName === selectedService.value)
  return svc ? svc.methods : []
})

watch(services, (newList) => {
  if (newList && newList.length) {
    const existing = newList.find(s => s.fullName === selectedService.value)
    if (existing) {
      const methodExists = (existing.methods || []).some(m => m.name === selectedMethod.value)
      if (!methodExists) selectedMethod.value = null
    } else {
      // do not auto select; keep placeholders until user chooses
      selectedService.value = null
      selectedMethod.value = null
    }
  } else {
    selectedService.value = null
    selectedMethod.value = null
  }
}, { immediate: true })

watch([selectedService, selectedMethod], () => {
  if (!props.protoRoot || !selectedService.value || !selectedMethod.value) return
  const svc = services.value.find(s => s.fullName === selectedService.value)
  if (!svc) return
  const m = svc.methods.find(mm => mm.name === selectedMethod.value)
  if (!m) return
  // sync selected to header values
  service.value = svc.fullName
  method.value = m.name
  try {
    const isRestoredSelection = suppressAutoFill.value &&
      lastRestoredService.value === service.value &&
      lastRestoredMethod.value === method.value
    if (!isRestoredSelection) {
      const defaultObj = makeDefaultMessageJson(props.protoRoot, m.requestType)
      requestJson.value = JSON.stringify(defaultObj, null, 2)
    }
    suppressAutoFill.value = false
  } catch (e) {
    // ignore, keep user input
  }
})

const sendRequest = async () => {
  loading.value = true
  resp.status = null
  resp.durationMs = null
  resp.headers = {}
  resp.body = ''
  const start = performance.now()
  try {
    if (!endpointUrl.value) throw new Error('请先填写请求地址')
    const protos = loadSavedProtoContents()
    if (!protos.length) throw new Error('未找到已导入的 proto 文件，请先在左侧导入')
    const body = {
      protos,
      addr: endpointUrl.value,
      service: service.value,
      method: method.value,
      body: requestJson.value || ''
    }
    const r = await api.post('/grpcCall', body)
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

const reset = () => {
  if (services.value.length && services.value[0].methods.length) {
    selectedService.value = services.value[0].fullName
    selectedMethod.value = services.value[0].methods[0].name
  } else {
    service.value = 'helloworld.Greeter'
    method.value = 'SayHello'
    requestJson.value = '{"name":"world"}'
  }
}

const restore = (payload) => {
  suppressAutoFill.value = true
  selectedService.value = payload.service
  selectedMethod.value = payload.method
  service.value = payload.service
  method.value = payload.method
  requestJson.value = payload.requestJson
  endpointUrl.value = payload.addr || ''
  lastRestoredService.value = payload.service
  lastRestoredMethod.value = payload.method
}

const addToFlow = () => {
  emit('add-to-flow', {
    type: 'gRPC',
    title: `${service.value}/${method.value}`,
    payload: {
      service: service.value,
      method: method.value,
      requestJson: requestJson.value,
      addr: endpointUrl.value
    }
  })
}

const updateFlow = () => {
  emit('update-flow', {
    type: 'gRPC',
    title: `${service.value}/${method.value}`,
    payload: {
      service: service.value,
      method: method.value,
      requestJson: requestJson.value,
      addr: endpointUrl.value
    }
  })
}

defineExpose({ restore })

function loadSavedProtoContents() {
  try {
    const raw = localStorage.getItem('grpc:protoFiles')
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(it => it.content).filter(Boolean)
  } catch {
    return []
  }
}
</script>