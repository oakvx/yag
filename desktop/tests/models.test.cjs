'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../ui/models.js'), 'utf8')
function setup() {
  const records = new Map()
  const storage = {
    getItem: k => records.get(k) ?? null,
    setItem: (k, v) => records.set(k, String(v)),
    removeItem: k => records.delete(k)
  }
  const window = {}
  vm.runInNewContext(source, {window, localStorage: storage, URL, JSON, Set, Array, String})
  return {models: window.YagModels, storage, records}
}

test('favorites are explicitly pinned, scoped per canonical Host origin and reversible', () => {
  const {models, storage, records} = setup()
  assert.equal(models.toggle('https://192.168.1.50/', 'qwen2.5', storage), true)
  assert.deepEqual(Array.from(models.favorites('https://192.168.1.50', storage)), ['qwen2.5'])
  assert.deepEqual(Array.from(models.favorites('https://192.168.1.60', storage)), [])
  assert.equal(models.toggle('https://192.168.1.50', 'qwen2.5', storage), true)
  assert.deepEqual(Array.from(models.favorites('https://192.168.1.50', storage)), [])
  assert.equal(records.get('yag.desktop.favorites.v1').includes('apiKey'), false)
})

test('prevents credential-bearing URLs and untrusted remote plaintext HTTP', () => {
  const {models, storage} = setup()
  for (const origin of ['https://user:password@host.example', 'http://host.example',
      'https://host.example/path', 'https://host.example/?key=private',
      'file:///tmp', 'javascript:alert(1)']) {
    assert.equal(models.toggle(origin, 'model', storage), false, origin)
  }
  assert.equal(models.toggle('http://127.0.0.1:8080', 'local-model', storage), true)
})

test('filter is case insensitive and sorts pins first without mutating inventory', () => {
  const {models} = setup()
  const inventory = [{id:'zeta'}, {id:'qwen-14B'}, {id:'Qwen-7B'}, {id:'bad\u0000name'}]
  const results = models.filter(inventory, 'QwEN', ['qwen-14B'])
  assert.deepEqual(Array.from(results, x => x.id), ['qwen-14B', 'Qwen-7B'])
  assert.equal(inventory[0].id, 'zeta')
})

test('corrupt records and oversized pinned sets fail closed', () => {
  const {models, storage} = setup()
  storage.setItem('yag.desktop.favorites.v1', '{not json')
  assert.deepEqual(Array.from(models.favorites('https://host.example', storage)), [])
  for (let i = 0; i < 20; i++) {
    assert.equal(models.toggle('https://host.example', 'm-' + i, storage), true)
  }
  assert.equal(models.toggle('https://host.example', 'too-many', storage), false)
  assert.equal(models.favorites('https://host.example', storage).length, 20)
})
