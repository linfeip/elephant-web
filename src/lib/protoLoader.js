import * as protobuf from 'protobufjs'

function normalizePath(path) {
  // simple normalization for './' and '../'
  const parts = []
  path.split('/').forEach((p) => {
    if (!p || p === '.') return
    if (p === '..') parts.pop()
    else parts.push(p)
  })
  return parts.join('/')
}

function joinPath(origin, target) {
  if (!origin) return normalizePath(target)
  if (target.startsWith('/')) return normalizePath(target)
  const originDir = origin.includes('/') ? origin.slice(0, origin.lastIndexOf('/')) : ''
  return normalizePath((originDir ? originDir + '/' : '') + target)
}

export async function buildFilesMapFromFileList(fileList) {
  const map = {}
  for (const f of fileList) {
    const text = await f.text()
    // use relative name
    map[f.name] = text
  }
  return map
}

export async function loadProtosFromMap(filesMap, entryFiles) {
  const root = new protobuf.Root()
  const visited = new Set()

  const resolveImport = (fromFile, target) => {
    const resolved = joinPath(fromFile || '', target)
    if (filesMap[resolved] != null) return resolved
    if (filesMap[target] != null) return target
    return resolved
  }

  const parseFile = (filename) => {
    if (!filename || visited.has(filename)) return
    const content = filesMap[filename]
    if (!content) return
    const res = protobuf.parse(content, root, { keepCase: true })
    visited.add(filename)
    const imports = Array.isArray(res.imports) ? res.imports : []
    for (const imp of imports) {
      const next = resolveImport(filename, imp)
      if (filesMap[next]) parseFile(next)
    }
  }

  const seeds = entryFiles && entryFiles.length ? entryFiles : Object.keys(filesMap)
  for (const seed of seeds) parseFile(seed)

  root.resolveAll()
  return root
}

export function listServices(root) {
  const services = []

  function walk(namespace, fullNamePrefix = '') {
    if (!namespace || !namespace.nested) return
    for (const [name, obj] of Object.entries(namespace.nested)) {
      const fullName = fullNamePrefix ? `${fullNamePrefix}.${name}` : name
      if (obj instanceof protobuf.Service) {
        const methods = Object.entries(obj.methods).map(([mName, m]) => ({
          name: mName,
          requestType: m.requestType,
          responseType: m.responseType
        }))
        services.push({ name, fullName, methods })
      } else if (obj.nested) {
        walk(obj, fullName)
      }
    }
  }

  walk(root)
  return services
}

const SCALAR_DEFAULTS = {
  double: 0,
  float: 0,
  int32: 0,
  int64: 0,
  uint32: 0,
  uint64: 0,
  sint32: 0,
  sint64: 0,
  fixed32: 0,
  fixed64: 0,
  sfixed32: 0,
  sfixed64: 0,
  bool: false,
  string: '',
  bytes: ''
}

export function makeDefaultMessageJson(root, typeName, depthLimit = 5, seen = new Set()) {
  if (depthLimit <= 0) return {}
  const type = root.lookupType(typeName)
  if (!type) return {}

  // prevent infinite recursion on self-referencing types
  const seenKey = type.fullName
  if (seen.has(seenKey)) return {}
  seen.add(seenKey)

  const obj = {}
  for (const field of type.fieldsArray) {
    // handle oneof: only set first field by default
    if (field.partOf) {
      // only set for the first encountered field of the oneof
      const priorSet = obj.__oneofSet || new Set()
      if (!priorSet.has(field.partOf.name)) {
        obj[field.name] = defaultFieldValue(root, field, depthLimit - 1, seen)
        priorSet.add(field.partOf.name)
        obj.__oneofSet = priorSet
      }
      continue
    }
    obj[field.name] = defaultFieldValue(root, field, depthLimit - 1, seen)
  }
  if (obj.__oneofSet) delete obj.__oneofSet
  return obj
}

function defaultFieldValue(root, field, depthLimit, seen) {
  const rule = field.repeated ? 'repeated' : (field.map ? 'map' : 'single')
  if (rule === 'repeated') {
    return []
  }
  if (rule === 'map') {
    return {}
  }
  if (SCALAR_DEFAULTS.hasOwnProperty(field.type)) {
    return SCALAR_DEFAULTS[field.type]
  }
  // enum
  const enumType = root.lookupEnum(field.type)
  if (enumType) {
    const first = Object.keys(enumType.values)[0]
    return first || 0
  }
  // message
  return makeDefaultMessageJson(root, field.type, depthLimit, new Set(seen))
}