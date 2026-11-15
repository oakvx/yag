'use strict'

// Optional, explicit local model favourites. Only server origins and model IDs
// are persisted; never API keys, model responses or conversation content.
;(function () {
  const KEY = 'yag.desktop.favorites.v1'
  const MAX_SERVERS = 8
  const MAX_MODELS = 20

  function validOrigin(origin) {
    if (typeof origin !== 'string' || origin.length > 256) return false
    try {
      const parsed = new URL(origin)
      return ['https:', 'http:'].includes(parsed.protocol) &&
        parsed.username === '' && parsed.password === '' &&
        parsed.pathname === '/' && parsed.search === '' && parsed.hash === '' &&
        parsed.origin === origin
    } catch { return false }
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
        if (!record || !validOrigin(record.origin) || seen.has(record.origin) ||
            !Array.isArray(record.models)) return []
        seen.add(record.origin)
        return [{origin: record.origin, models: [...new Set(record.models
          .filter(validId))].slice(0, MAX_MODELS)}]
      })
    } catch { return [] }
  }

  function favorites(origin, storage = localStorage) {
    if (!validOrigin(origin)) return []
    return read(storage).find(record => record.origin === origin)?.models || []
  }

  function toggle(origin, id, storage = localStorage) {
    if (!validOrigin(origin) || !validId(id)) return false
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
