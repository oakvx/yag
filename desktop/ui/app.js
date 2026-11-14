'use strict'

// Renderer has no network, filesystem or shell permissions. All YAG HTTP
// requests are issued by the native Rust bridge with certificate verification.
const tauri = window.__TAURI__
const invoke = tauri.core.invoke
const Channel = tauri.core.Channel

const el = (id) => document.getElementById(id)
const state = {
  url: '',
  apiKey: '', // Never written to localStorage, files or console output.
  models: [],
  model: '',
  messages: [],
  requestId: null,
  running: false,
  usage: null
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
  el('connectionIndicator').classList.toggle('online', online)
  el('statusPill').classList.toggle('online', online)
  el('statusPill').textContent = online ? 'CONNECTED' : 'OFFLINE'
  el('statusText').textContent = online ? 'Ready for inference' : 'Disconnected'
  el('serverLabel').textContent = online ? new URL(state.url).host : 'Not connected'
  el('serverHint').textContent = online ? 'Secure YAG Host' : 'Select a YAG host'
  el('currentModel').textContent = state.model || 'Select a model'
  el('prompt').disabled = !online || !state.model || state.running
  el('prompt').placeholder = online ? 'Ask ' + (state.model || 'a model') + ' anything…' : 'Connect to a server to begin…'
  el('composerHint').textContent = state.running ? 'Generating on YAG Host…' : (state.model ? 'Enter to send · Shift+Enter for new line' : 'Select a model to start chatting')
  el('sendButton').disabled = !online || !state.model || state.running
  el('sendButton').hidden = state.running
  el('stopButton').hidden = !state.running
  el('refreshButton').disabled = !online || state.running
  el('newChatButton').disabled = state.running
  el('disconnectButton').disabled = state.running
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
      if (state.model !== model.id && state.messages.length &&
          !window.confirm('Switch model? This will start a new conversation.')) return
      state.model = model.id
      clearConversation()
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
    text.textContent = message.content
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
  state.messages = []
  state.usage = null
  el('usageText').textContent = 'No requests yet'
  showError('')
  renderMessages()
}
async function refreshModels() {
  if (!state.url || !state.apiKey || state.running) return
  el('refreshButton').disabled = true
  try {
    const models = await invoke('list_models', { url: state.url, apiKey: state.apiKey })
    state.models = models
    if (!models.some((model) => model.id === state.model)) {
      state.model = models.length ? models[0].id : ''
      clearConversation()
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
    state.url = url
    state.apiKey = apiKey
    state.models = models
    state.model = models.some((model) => model.id === state.model) ? state.model : (models[0]?.id || '')
    if (changed) clearConversation()
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
function disconnect() {
  if (state.running) return
  state.url = ''
  state.apiKey = ''
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
  state.messages.push({ role: 'user', content })
  const requestMessages = state.messages.map((message) => ({ role: message.role, content: message.content }))
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
      if (node) node.textContent = assistant.content
      el('chat').scrollTop = el('chat').scrollHeight
    } else if (event.kind === 'usage') {
      state.usage = event
      el('usageText').textContent = 'INPUT ' + event.prompt_tokens + ' · OUTPUT ' + event.completion_tokens + ' TOKENS'
    }
  }
  try {
    await invoke('stream_chat', {
      url: state.url, apiKey: state.apiKey, model: state.model,
      messages: requestMessages, requestId, onEvent: channel
    })
  } catch (error) {
    const message = String(error)
    if (message !== 'Generation stopped') showError(message)
    if (!assistant.content) state.messages.pop()
  } finally {
    if (state.requestId === requestId) {
      state.requestId = null
      state.running = false
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
})
el('connectionDialog').addEventListener('click', (event) => {
  if (event.target === el('connectionDialog')) closeDialog()
})
renderModels()
renderMessages()
setStatus(false)
openDialog()
