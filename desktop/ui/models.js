'use strict'

// Optional, explicit local model favourites. Only server origins and model IDs
// are persisted; never API keys, model responses or conversation content.
;(function () {
  const KEY = 'yag.desktop.favorites.v1'
  const MAX_SERVERS = 8
  const MAX_MODELS = 20

  function canonicalOrigin(origin) {
    if (typeof origin !== 'string' || origin.length > 256) return null
    try {
      const parsed = new URL(origin)
      if (!['https:', 'http:'].includes(parsed.protocol) ||
          (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) ||
          parsed.username !== '' || parsed.password !== '' ||
          parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return null
      if (origin !== parsed.origin && origin !== parsed.origin + '/') return null
      return parsed.origin
    } catch { return null }
  }

  function validId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 255 &&
      !/[\u0000-\u001f\u007f]/.test(id)
  }

  function read(storage = localStorage) {
    try {
      const parsed = JSON.parse(storage.getItem(KEY) || '{}')
      if (parsed.version !== 1 || !Array.isArray(parsed.servers)) return []
      const seen = new Set()
      return parsed.servers.slice(0, MAX_SERVERS).flatMap(record => {
        const canonical = record && canonicalOrigin(record.origin)
        if (!canonical || seen.has(canonical) || !Array.isArray(record.models)) return []
        seen.add(canonical)
        return [{origin: canonical, models: [...new Set(record.models
          .filter(validId))].slice(0, MAX_MODELS)}]
      })
    } catch { return [] }
  }

  function favorites(origin, storage = localStorage) {
    const canonical = canonicalOrigin(origin)
    if (!canonical) return []
    return read(storage).find(record => record.origin === canonical)?.models || []
  }

  function toggle(origin, id, storage = localStorage) {
    const canonical = canonicalOrigin(origin)
    if (!canonical || !validId(id)) return false
    origin = canonical
    const servers = read(storage)
    let record = servers.find(entry => entry.origin === origin)
    if (!record) {
      if (servers.length >= MAX_SERVERS) servers.shift()
      record = {origin, models: []}
      servers.push(record)
    }
    const index = record.models.indexOf(id)
    if (index !== -1) record.models.splice(index, 1)
    else if (record.models.length >= MAX_MODELS) return false
    else record.models.unshift(id)
    try {
      storage.setItem(KEY, JSON.stringify({version: 1, servers}))
      return true
    } catch { return false }
  }

  function filter(models, query, pinned = []) {
    const needle = String(query || '').trim().toLocaleLowerCase()
    const favorite = new Set(pinned)
    return models.filter(model => model && validId(model.id) &&
        (!needle || model.id.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => Number(favorite.has(b.id)) - Number(favorite.has(a.id)) ||
        a.id.localeCompare(b.id))
  }

  window.YagModels = Object.freeze({favorites, toggle, filter})
})()
