'use strict'

// Local, explicit opt-in history. No API keys, cookies or authentication data.
// The WebView profile stores this data without at-rest application encryption.
;(function () {
  const HISTORY = 'yag.desktop.history.v1'
  const OPT_IN = 'yag.desktop.history.enabled'
  const LIMIT_CHATS = 40
  const LIMIT_MESSAGES = 80
  const LIMIT_TOTAL_CHARS = 2_000_000

  function enabled(store = localStorage) {
    try { return store.getItem(OPT_IN) === 'yes' } catch { return false }
  }

  function setEnabled(yes, store = localStorage) {
    if (yes) {
      store.setItem(OPT_IN, 'yes')
    } else {
      store.removeItem(OPT_IN)
      store.removeItem(HISTORY)
    }
  }

  function sanitizeMessage(m) {
    if (!m || !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' || m.content.length > 32768) return null
    return { role: m.role, content: m.content }
  }

  function sanitizeChat(chat) {
    if (!chat || !/^[\da-f-]{36}$/i.test(chat.id) ||
        typeof chat.host !== 'string' || chat.host.length > 300 ||
        typeof chat.model !== 'string' || chat.model.length > 255 ||
        !Array.isArray(chat.messages) || chat.messages.length > LIMIT_MESSAGES ||
        typeof chat.updated !== 'number' || !Number.isFinite(chat.updated)) return null
    const messages = chat.messages.map(sanitizeMessage)
    if (messages.includes(null)) return null
    const title = typeof chat.title === 'string' ? chat.title.slice(0, 100) : 'Conversation'
    return { id: chat.id, host: chat.host, model: chat.model, title, updated: chat.updated, messages }
  }

  function validateCollection(input) {
    if (!Array.isArray(input) || input.length > LIMIT_CHATS) return []
    const chats = []
    const ids = new Set()
    let size = 0
    for (const item of input) {
      const chat = sanitizeChat(item)
      if (!chat || ids.has(chat.id)) continue
      size += JSON.stringify(chat).length
      if (size > LIMIT_TOTAL_CHARS) break
      ids.add(chat.id)
      chats.push(chat)
    }
    return chats.sort((a, b) => b.updated - a.updated)
  }

  function load(store = localStorage) {
    if (!enabled(store)) return []
    try {
      const value = store.getItem(HISTORY)
      return value ? validateCollection(JSON.parse(value)) : []
    } catch { return [] }
  }

  function save(chats, store = localStorage) {
    if (!enabled(store)) return false
    const clean = validateCollection(chats)
    try {
      store.setItem(HISTORY, JSON.stringify(clean))
      return true
    } catch { return false }
  }

  function makeChat(host, model, messages = []) {
    return {
      id: crypto.randomUUID(), host, model,
      title: messages.find(m => m.role === 'user')?.content.slice(0, 60) || 'New conversation',
      updated: Date.now(), messages: messages.map(sanitizeMessage).filter(Boolean)
    }
  }

  window.YagWorkspace = Object.freeze({
    enabled, setEnabled, sanitizeChat, validateCollection, load, save, makeChat,
    limits: Object.freeze({ chats: LIMIT_CHATS, messages: LIMIT_MESSAGES })
  })
})()
