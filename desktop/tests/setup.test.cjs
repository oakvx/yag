'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../ui/setup.js'), 'utf8')

function setup(initial = {}) {
  const record = new Map(Object.entries(initial))
  const storage = {
    getItem: (k) => record.get(k) ?? null,
    setItem: (k, v) => record.set(k, v)
  }
  const window = {}
  vm.runInNewContext(source, {window})
  return {controller: window.YagSetup, storage, record}
}

test('fresh install shows welcome, but previously configured hosts retain connection dialog', () => {
  const first = setup()
  assert.equal(first.controller.shouldWelcome(first.storage), true)
  const existing = setup({'yag.desktop.url': 'https://colibri.lan'})
  assert.equal(existing.controller.shouldWelcome(existing.storage), false)
})

test('wizard only progresses on explicit user actions and success', () => {
  const {controller} = setup()
  assert.equal(controller.transition('welcome', 'begin'), 'connect')
  assert.equal(controller.transition('connect', 'authenticated'), 'done')
  assert.equal(controller.transition('connect', 'failed'), 'connect')
  assert.equal(controller.transition('done', 'finish'), 'closed')
  assert.equal(controller.transition('welcome', 'skip'), 'closed')
})

test('marking completed persists a boolean, never an API key', () => {
  const {controller, storage, record} = setup()
  assert.equal(controller.markComplete(storage), true)
  assert.equal(controller.shouldWelcome(storage), false)
  assert.deepEqual([...record.entries()], [['yag.desktop.setupComplete.v1', 'true']])
})
