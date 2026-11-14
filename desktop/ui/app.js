'use strict'

// Renderer has no network, filesystem or shell permissions. All YAG HTTP
// requests are issued by the native Rust bridge with certificate verification.
const tauri = window.__TAURI__
const invoke = tauri.core.invoke
const Channel = tauri.core.Channel
const Workspace = window.YagWorkspace
const Markdown = window.YagMarkdown

const el = (id) => document.getElementById(id)
const state = {
  url: '',
  apiKey: '', // Never written to localStorage, files or console output.
  models: [],
  model: '',
  messages: [],
  requestId: null,
  running: false,
  usage: null,
  online: false,
  conversations: Workspace.load(),
  activeChatId: null,
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: '',
  relay: null
}


function saveActive() {
  if (!state.activeChatId) return
  const record = state.conversations.find(c => c.id === state.activeChatId)
  if (!record) return
  record.messages = state.messages.map(m => ({ role: m.role, content: m.content }))
  record.model = state.model
  record.updated = Date.now()
  const first = record.messages.find(m => m.role === 'user')
  if (record.title === 'New conversation' && first) record.title = first.content.slice(0, 60)
  state.conversations.sort((a, b) => b.updated - a.updated)
  if (state.conversations.length > Workspace.limits.chats) state.conversations.length = Workspace.limits.chats
  if (Workspace.enabled() && !Workspace.save(state.conversations)) {
    showError('Local conversation storage is full. Free space or disable history in Preferences.')
  }
  renderConversations()
}
function ensureChat() {
  if (state.activeChatId) return
  const record = Workspace.makeChat(state.url, state.model)
  state.activeChatId = record.id
  state.conversations.unshift(record)
  renderConversations()
}
function renderConversations() {
  const root = el('conversationList')
  root.replaceChildren()
  const query = el('chatSearch').value.toLocaleLowerCase().trim()
  const matching = state.conversations.filter(c => c.host === state.url &&
    (c.title.toLocaleLowerCase().includes(query) || c.model.toLocaleLowerCase().includes(query) ||
     c.messages.some(m => m.content.toLocaleLowerCase().includes(query))))
  if (!matching.length) {
    const p = document.createElement('p')
    p.className = 'conversation-placeholder'
    p.textContent = state.url ? 'No conversations on this host.' : 'Connect to a YAG Host first.'
    root.append(p)
  }
  for (const chat of matching) {
    const row = document.createElement('div')
    row.className = 'conversation-row' + (chat.id === state.activeChatId ? ' active' : '')
    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'conversation-main'
    const title = document.createElement('strong')
    title.textContent = chat.title || 'Conversation'
    const detail = document.createElement('small')
    detail.textContent = chat.model
    main.append(title, detail)
    main.disabled = state.running
    main.addEventListener('click', () => {
      if (state.running || chat.id === state.activeChatId) return
      if (!state.models.some(m => m.id === chat.model)) {
        showError('That model is no longer offered by this server.')
        return
      }
      saveActive()
      state.activeChatId = chat.id
      state.model = chat.model
      state.messages = chat.messages.map(m => ({ ...m }))
      state.usage = null
      el('usageText').textContent = 'Saved conversation'
      renderModels()
      renderConversations()
      renderMessages()
      setStatus(state.online)
    })
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'conversation-action'
    rename.title = 'Rename conversation'
    rename.textContent = '✎'
    rename.disabled = state.running
    rename.addEventListener('click', () => {
      const name = window.prompt('Rename conversation', chat.title)
      if (name === null || !name.trim()) return
      chat.title = name.trim().slice(0, 100)
      Workspace.save(state.conversations)
      renderConversations()
    })
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'conversation-action'
    del.title = 'Delete conversation'
    del.textContent = '×'
    del.disabled = state.running
    del.addEventListener('click', () => {
      if (!window.confirm('Permanently delete this conversation from this device?')) return
      state.conversations = state.conversations.filter(c => c.id !== chat.id)
      if (state.activeChatId === chat.id) {
        state.activeChatId = null
        state.messages = []
        renderMessages()
      }
      Workspace.save(state.conversations)
      renderConversations()
    })
    row.append(main, rename, del)
    root.append(row)
  }
}

function showError(message) {
  const banner = el('errorBanner')
  banner.textContent = message
  banner.hidden = !message
}
function connectionError(message) {
  el('connectionError').textContent = message
  el('connectionError').hidden = !message
}
function openDialog() {
  el('serverUrl').value = state.url || localStorage.getItem('yag.desktop.url') || ''
  el('apiKey').value = state.apiKey
  connectionError('')
  el('connectionDialog').hidden = false
  el('serverUrl').focus()
}
function closeDialog() {
  el('connectionDialog').hidden = true
}
function setStatus(online) {
  state.online = online
  el('connectionIndicator').classList.toggle('online', online)
  el('statusPill').classList.toggle('online', online)
  el('statusPill').textContent = online ? 'CONNECTED' : 'OFFLINE'
  el('statusText').textContent = online ? 'Ready for inference' : 'Disconnected'
  el('serverLabel').textContent = online ? new URL(state.url).host : 'Not connected'
  el('serverHint').textContent = online ? 'YAG Host' : 'Select a YAG host'
  el('currentModel').textContent = state.model || 'Select a model'
  el('prompt').disabled = !online || !state.model || state.running
  el('prompt').placeholder = online ? 'Ask ' + (state.model || 'a model') + ' anything…' : 'Connect to a server to begin…'
  el('composerHint').textContent = state.running ? 'Generating on YAG Host…' : (state.model ? 'Enter to send · Shift+Enter for new line' : 'Select a model to start chatting')
  el('sendButton').disabled = !online || !state.model || state.running
  el('sendButton').hidden = state.running
  el('stopButton').hidden = !state.running
  el('refreshButton').disabled = !online || state.running
  el('newChatButton').disabled = state.running
  el('copyChatButton').disabled = state.messages.length === 0 || state.running
  el('disconnectButton').disabled = state.running
  updateRelayDisplay()
}
function renderModels() {
  const root = el('models')
  root.replaceChildren()
  if (!state.models.length) {
    const p = document.createElement('p')
    p.className = 'muted model-placeholder'
    p.textContent = state.url ? 'No models reported by the server. Ask the host administrator to install one.' : 'Connect to a YAG server to discover its models.'
    root.append(p)
    return
  }
  state.models.forEach((model) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'model-item' + (model.id === state.model ? ' active' : '')
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(model.id === state.model))
    button.disabled = state.running
    const icon = document.createElement('span')
    icon.className = 'model-icon'
    icon.textContent = 'AI'
    const meta = document.createElement('span')
    meta.style.minWidth = '0'
    const name = document.createElement('strong')
    name.textContent = model.id
    name.title = model.id
    const label = document.createElement('small')
    label.textContent = 'Remote inference'
    meta.append(name, label)
    button.append(icon, meta)
    button.addEventListener('click', () => {
      if (state.model !== model.id) clearConversation()
      state.model = model.id
      renderModels()
      setStatus(true)
      el('prompt').focus()
    })
    root.append(button)
  })
}
function renderMessages() {
  const root = el('messages')
  root.replaceChildren()
  el('emptyState').hidden = state.messages.length > 0
  for (const message of state.messages) {
    const article = document.createElement('article')
    article.className = 'message ' + message.role
    const avatar = document.createElement('div')
    avatar.className = 'message-avatar'
    avatar.textContent = message.role === 'assistant' ? 'Y' : 'U'
    const body = document.createElement('div')
    const header = document.createElement('div')
    header.className = 'message-header'
    header.textContent = message.role === 'assistant' ? state.model : 'You'
    const text = document.createElement('div')
    text.className = 'message-content'
    Markdown.render(text, message.content)
    if (state.running && message === state.messages[state.messages.length - 1] && message.role === 'assistant') {
      text.classList.add('typing-caret')
    }
    body.append(header, text)
    article.append(avatar, body)
    root.append(article)
  }
  el('chat').scrollTop = el('chat').scrollHeight
}
function clearConversation() {
  saveActive()
  state.activeChatId = null
  state.messages = []
  state.usage = null
  el('usageText').textContent = 'No requests yet'
  showError('')
  renderMessages()
  renderConversations()
}
async function refreshModels() {
  if (!state.url || !state.apiKey || state.running) return
  el('refreshButton').disabled = true
  try {
    const models = await invoke('list_models', { url: state.url, apiKey: state.apiKey })
    state.models = models
    if (!models.some((model) => model.id === state.model)) {
      clearConversation()
      state.model = models.length ? models[0].id : ''
    }
    renderModels()
    setStatus(true)
    showError('')
  } catch (error) {
    showError(String(error))
    // Never silently reuse a stale inventory when authentication has failed.
    state.models = []
    state.model = ''
    renderModels()
    setStatus(false)
  }
}
async function connect(event) {
  event.preventDefault()
  if (state.running) return
  const url = el('serverUrl').value.trim()
  const apiKey = el('apiKey').value.trim()
  const button = el('connectButton')
  button.disabled = true
  button.textContent = 'Connecting…'
  connectionError('')
  try {
    const models = await invoke('list_models', { url, apiKey })
    const changed = state.url !== url || state.apiKey !== apiKey
    if (changed && state.relay) await stopRelay()
    if (changed) {
      saveActive()
      state.activeChatId = null
    }
    state.url = url
    state.apiKey = apiKey
    state.models = models
    state.model = models.some((model) => model.id === state.model) ? state.model : (models[0]?.id || '')
    if (changed) clearConversation()
    renderConversations()
    // Only the non-secret server address is remembered.
    localStorage.setItem('yag.desktop.url', url)
    renderModels()
    setStatus(true)
    closeDialog()
    showError('')
    el('prompt').focus()
  } catch (error) {
    connectionError(String(error))
  } finally {
    button.disabled = false
    button.replaceChildren(document.createTextNode('Connect & discover models '))
    const arrow = document.createElement('span')
    arrow.textContent = '↗'
    button.append(arrow)
  }
}
async function disconnect() {
  if (state.running) return
  if (state.relay) await stopRelay()
  saveActive()
  state.url = ''
  state.apiKey = ''
  state.activeChatId = null
  state.model = ''
  state.models = []
  el('apiKey').value = ''
  clearConversation()
  renderModels()
  setStatus(false)
  closeDialog()
}
async function sendMessage(event) {
  event.preventDefault()
  if (state.running || !state.model || !state.apiKey) return
  const content = el('prompt').value.trim()
  if (!content) return
  if (state.messages.length >= 78) {
    showError('Conversation limit reached. Start a new conversation.')
    return
  }
  showError('')
  ensureChat()
  state.messages.push({ role: 'user', content })
  const requestMessages = state.messages.map((message) => ({ role: message.role, content: message.content }))
  if (state.systemPrompt.trim()) requestMessages.unshift({role: 'system', content: state.systemPrompt.trim()})
  const assistant = { role: 'assistant', content: '' }
  state.messages.push(assistant)
  el('prompt').value = ''
  state.running = true
  const requestId = crypto.randomUUID()
  state.requestId = requestId
  setStatus(true)
  renderModels()
  renderMessages()
  const channel = new Channel()
  channel.onmessage = (event) => {
    if (state.requestId !== requestId) return
    if (event.kind === 'delta' && typeof event.text === 'string') {
      assistant.content += event.text
      const node = el('messages').lastElementChild?.querySelector('.message-content')
      if (node) Markdown.render(node, assistant.content)
      el('chat').scrollTop = el('chat').scrollHeight
    } else if (event.kind === 'usage') {
      state.usage = event
      el('usageText').textContent = 'INPUT ' + event.prompt_tokens + ' · OUTPUT ' + event.completion_tokens + ' TOKENS'
    }
  }
  try {
    await invoke('stream_chat', {
      url: state.url, apiKey: state.apiKey, model: state.model,
      messages: requestMessages, requestId, onEvent: channel,
      temperature: state.temperature, maxTokens: state.maxTokens
    })
  } catch (error) {
    const message = String(error)
    if (message !== 'Generation stopped') showError(message)
    if (!assistant.content) state.messages.pop()
  } finally {
    if (state.requestId === requestId) {
      state.requestId = null
      state.running = false
      saveActive()
      setStatus(true)
      renderModels()
      renderMessages()
      el('prompt').focus()
    }
  }
}
async function stopGeneration() {
  if (state.requestId) {
    el('stopButton').disabled = true
    try { await invoke('cancel_chat', { requestId: state.requestId }) }
    catch (error) { showError(String(error)) }
    finally { el('stopButton').disabled = false }
  }
}

function openSettings() {
  el('saveHistory').checked = Workspace.enabled()
  el('temperature').value = state.temperature
  el('temperatureValue').value = state.temperature.toFixed(1)
  el('maxTokens').value = state.maxTokens
  el('systemPrompt').value = state.systemPrompt
  el('settingsDialog').hidden = false
}
function closeSettings() { el('settingsDialog').hidden = true }
function updateRelayDisplay() {
  el('relayDetails').hidden = !state.relay
  el('startRelay').disabled = !state.online || !state.apiKey || !!state.relay
  el('stopRelay').disabled = !state.relay
  if (state.relay) {
    el('relayUrl').textContent = state.relay.url + '/v1'
    el('relayKey').textContent = state.relay.token
  } else {
    el('relayUrl').textContent = ''
    el('relayKey').textContent = ''
  }
}
async function stopRelay() {
  try { await invoke('stop_relay') }
  catch (error) { el('relayError').hidden = false; el('relayError').textContent = String(error) }
  finally { state.relay = null; updateRelayDisplay() }
}
async function startRelay() {
  if (!state.online || !state.apiKey || state.relay) return
  el('relayError').hidden = true
  el('startRelay').disabled = true
  try {
    state.relay = await invoke('start_relay', {url: state.url, apiKey: state.apiKey})
  } catch (error) {
    el('relayError').textContent = String(error)
    el('relayError').hidden = false
  }
  updateRelayDisplay()
}
async function discoverHosts() {
  const button = el('discoverButton')
  button.disabled = true
  el('discoveryStatus').textContent = 'Searching for advertised servers…'
  el('discoveryResults').replaceChildren()
  try {
    const hosts = await invoke('discover_hosts')
    el('discoveryStatus').textContent = hosts.length ? 'Select a host:' : 'No YAG mDNS advertisements found.'
    for (const host of hosts) {
      const button = document.createElement('button')
      button.className = 'discovery-result'
      button.type = 'button'
      const name = document.createElement('strong')
      name.textContent = host.name
      const address = document.createElement('small')
      address.textContent = host.url
      button.append(name, address)
      button.addEventListener('click', () => {
        el('serverUrl').value = host.url
        el('discoveryStatus').textContent = 'Selected. Verify the TLS certificate and provide your client API key.'
      })
      el('discoveryResults').append(button)
    }
  } catch (error) {
    el('discoveryStatus').textContent = String(error)
  } finally { button.disabled = false }
}

el('copyChatButton').addEventListener('click', async () => {
  if (!state.messages.length || state.running) return
  const transcript = state.messages.map(message =>
    '## ' + (message.role === 'assistant' ? state.model : 'User') +
    '\n\n' + message.content
  ).join('\n\n---\n\n')
  try {
    await navigator.clipboard.writeText(transcript)
    el('copyChatButton').textContent = 'Copied'
    setTimeout(() => { el('copyChatButton').textContent = 'Copy chat' }, 1500)
  } catch {
    showError('Clipboard access denied. Check operating-system permissions.')
  }
})
el('checkUpdates').addEventListener('click', async () => {
  const button = el('checkUpdates')
  button.disabled = true
  el('updateStatus').textContent = 'Checking published GitHub Releases…'
  try {
    const release = await invoke('check_updates')
    el('updateStatus').textContent = 'Installed: ' + release.current +
      ' · Latest release: ' + release.latest + ' · ' + release.url
  } catch (error) {
    el('updateStatus').textContent = String(error)
  } finally { button.disabled = false }
})
el('settingsButton').addEventListener('click', openSettings)
el('closeSettingsButton').addEventListener('click', closeSettings)
el('settingsDialog').addEventListener('click', event => {
  if (event.target === el('settingsDialog')) closeSettings()
})
el('temperature').addEventListener('input', () => {
  state.temperature = Number(el('temperature').value)
  el('temperatureValue').value = state.temperature.toFixed(1)
})
el('maxTokens').addEventListener('change', () => {
  const number = Number(el('maxTokens').value)
  state.maxTokens = Number.isInteger(number) && number >= 64 && number <= 8192 ? number : 1024
  el('maxTokens').value = state.maxTokens
})
el('systemPrompt').addEventListener('change', () => {
  state.systemPrompt = el('systemPrompt').value.slice(0, 4000)
})
el('saveHistory').addEventListener('change', () => {
  try {
    Workspace.setEnabled(el('saveHistory').checked)
    if (Workspace.enabled()) {
      saveActive()
      if (!Workspace.save(state.conversations)) showError('Could not persist local history.')
    } else showError('')
  } catch {
    el('saveHistory').checked = false
    showError('Could not change local history settings.')
  }
})
el('clearHistory').addEventListener('click', () => {
  if (!window.confirm('Delete every locally saved conversation on this device?')) return
  state.conversations = []
  state.activeChatId = null
  state.messages = []
  try { Workspace.setEnabled(false); el('saveHistory').checked = false } catch {}
  renderMessages()
  renderConversations()
})
el('startRelay').addEventListener('click', startRelay)
el('stopRelay').addEventListener('click', stopRelay)
el('discoverButton').addEventListener('click', discoverHosts)
el('copyRelayKey').addEventListener('click', () => {
  if (state.relay) navigator.clipboard.writeText(state.relay.token).catch(() => {
    el('relayError').textContent = 'Clipboard access denied'
    el('relayError').hidden = false
  })
})

el('chatSearch').addEventListener('input', renderConversations)
el('newSidebarChat').addEventListener('click', clearConversation)
el('serverButton').addEventListener('click', openDialog)
el('emptyConnectButton').addEventListener('click', openDialog)
el('closeDialogButton').addEventListener('click', closeDialog)
el('connectForm').addEventListener('submit', connect)
el('disconnectButton').addEventListener('click', disconnect)
el('refreshButton').addEventListener('click', refreshModels)
el('newChatButton').addEventListener('click', clearConversation)
el('chatForm').addEventListener('submit', sendMessage)
el('stopButton').addEventListener('click', stopGeneration)
el('prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    el('chatForm').requestSubmit()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el('connectionDialog').hidden) closeDialog()
  if (event.key === 'Escape' && !el('settingsDialog').hidden) closeSettings()
})
el('connectionDialog').addEventListener('click', (event) => {
  if (event.target === el('connectionDialog')) closeDialog()
})
renderModels()
renderMessages()
setStatus(false)
renderConversations()
openDialog()
