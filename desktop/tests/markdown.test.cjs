'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../ui/markdown.js'), 'utf8')

function node(tag) {
  return {
    tag, children: [], textContent: '', events: {},
    append(...items) { this.children.push(...items) },
    replaceChildren(...items) { this.children = items },
    addEventListener(event, callback) { this.events[event] = callback }
  }
}
function setup() {
  const created = []
  const document = {
    createElement(tag) { const result = node(tag); created.push(result); return result },
    createTextNode(text) { const result = node('#text'); result.textContent = text; return result }
  }
  const window = {}
  vm.runInNewContext(source, { document, window, URL, navigator: {clipboard: {writeText: async () => {}}} })
  return { render: window.YagMarkdown.render, created }
}
test('does not parse user/model HTML as DOM markup', () => {
  const {render, created} = setup()
  const root = node('root')
  render(root, '<img src=x onerror=alert(1)>\n\n**safe**')
  assert.equal(created.some(n => n.tag === 'img' || n.tag === 'script'), false)
  assert.equal(root.children.length, 2)
})
test('creates heading, list and fenced code DOM elements', () => {
  const {render} = setup()
  const root = node('root')
  render(root, '# Heading\n- first\n- second\n```js\nconsole.log(1)\n```')
  assert.equal(root.children[0].tag, 'h3')
  assert.equal(root.children[1].tag, 'ul')
  assert.equal(root.children[2].children.some(n => n.tag === 'pre'), true)
})
test('links are strictly HTTPS and marked with noopener', () => {
  const {render, created} = setup()
  const root = node('root')
  render(root, '[safe](https://example.com/path) [bad](javascript:alert(1))')
  const links = created.filter(n => n.tag === 'a')
  assert.equal(links.length, 1)
  assert.equal(links[0].rel, 'noopener noreferrer')
})
