#!/usr/bin/env node
/**
 * Guard against making the XMB destination column invisible.
 *
 * Every .console-destination-position is absolutely positioned. Its UL parent
 * consequently has no intrinsic height. A percentage-based mask on that UL
 * masks the entire list out; apply the fade to the full-viewport menu instead.
 *
 * This is a structural CSS regression check, not an end-to-end visual test.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(resolve(projectRoot, 'src/index.css'), 'utf8')

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*\\{([^}]*)\\}', 'm')
  const matched = css.match(pattern)
  assert.ok(matched, 'Missing CSS rule: ' + selector)
  return matched[1]
}

const menu = rule('.console-menu')
const list = rule('.console-destinations ul')
const row = rule('.console-destination-position')

assert.match(row, /position:\s*absolute\s*;/, 'Destination rows must remain absolutely positioned')
assert.match(menu, /position:\s*absolute\s*;/, 'Menu needs a viewport layout box')
assert.match(menu, /inset:\s*0\s*;/, 'Menu must cover the viewport for its fade mask')
assert.match(menu, /-webkit-mask-image:\s*linear-gradient\([^;]+vh[^;]*\)/,
  'Full-viewport menu needs a prefixed footer fade')
assert.match(menu, /(?:^|[;\s])mask-image:\s*linear-gradient\([^;]+vh[^;]*\)/,
  'Full-viewport menu needs a footer fade')
assert.doesNotMatch(list, /(?:-webkit-)?mask(?:-image)?\s*:/,
  'Absolutely positioned destination list must never receive a mask')
console.log('PASS: full-viewport XMB fade leaves the zero-height UL unmasked')
