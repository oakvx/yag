'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../ui/workspace.js'), 'utf8')
function setup() {
  const records = new Map()
  const store = {
    getItem: k => records.get(k) ?? null,
    setItem: (k, v) => records.set(k, String(v)),
    removeItem: k => records.delete(k)
  }
  const window = {}
  vm.runInNewContext(source, {
    window, localStorage: store, crypto: {randomUUID: () => '11111111-1111-4111-8111-111111111111'},
    Date, JSON, Number, Array, String, Set, Object
  })
  return { workspace: window.YagWorkspace, store, records }
}
test('history is opt-in and disabling it deletes persisted conversations', () => {
  const { workspace, store, records } = setup()
  const chat = workspace.makeChat('https://192.168.1.50', 'model', [{ role: 'user', content: 'hello' }])
  assert.equal(workspace.save([chat], store), false)
  assert.equal(records.has('yag.desktop.history.v1'), false)
  workspace.setEnabled(true, store)
  assert.equal(workspace.save([chat], store), true)
  assert.equal(workspace.load(store).length, 1)
  workspace.setEnabled(false, store)
  assert.equal(records.has('yag.desktop.history.v1'), false)
  assert.equal(workspace.load(store).length, 0)
})
test('rejects malformed payloads and never stores unrecognized fields such as API keys', () => {
  const { workspace, store } = setup()
  workspace.setEnabled(true, store)
  const chat = workspace.makeChat('https://host.example', 'model', [{role:'assistant', content:'ok'}])
  chat.apiKey = 'super-secret'
  chat.messages[0].apiKey = 'not-safe'
  workspace.save([chat], store)
  const raw = store.getItem('yag.desktop.history.v1')
  assert.equal(raw.includes('super-secret'), false)
  assert.equal(raw.includes('not-safe'), false)
  assert.equal(workspace.load(store)[0].messages[0].content, 'ok')
})
test('bounds memory consumption, duplicate ids and corrupted records', () => {
  const { workspace, store } = setup()
  workspace.setEnabled(true, store)
  const chat = workspace.makeChat('https://example.com', 'model')
  assert.equal(workspace.validateCollection([chat, chat]).length, 1)
  chat.messages = [{role:'user', content:'a'.repeat(32769)}]
  assert.equal(workspace.validateCollection([chat]).length, 0)
  store.setItem('yag.desktop.history.v1', '{ bad JSON')
  assert.equal(workspace.load(store).length, 0)
})
