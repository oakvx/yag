#!/usr/bin/env node
/**
 * Minimal real-browser regression check for the production-built YAG Console.
 *
 * Uses Chromium's DevTools protocol and Node's built-in WebSocket; no test
 * framework or provider credentials are required. It checks offline navigation
 * and essential operator surfaces without invoking live administrative actions.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const previewUrl = 'http://127.0.0.1:4173'
const userData = mkdtempSync(join(tmpdir(), 'yag-console-browser-'))
let server
let chrome
let socket

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function retry(action, description, timeout = 20000) {
  const stop = Date.now() + timeout
  let last
  while (Date.now() < stop) {
    try {
      const result = await action()
      if (result) return result
    } catch (error) {
      last = error
    }
    if (server?.exitCode !== null && server?.exitCode !== undefined)
      throw new Error('Vite preview exited before ' + description)
    if (chrome && chrome.exitCode !== null)
      throw new Error('Chromium exited before ' + description)
    await delay(100)
  }
  throw new Error('Timed out waiting for ' + description + (last ? ': ' + last.message : ''))
}

async function main() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  const executable = candidates.find(name => spawnSync('which', [name], {stdio:'ignore'}).status === 0)
  if (!executable) throw new Error('A Chrome/Chromium browser is required for the UI smoke test')

  server = spawn(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'), 'preview',
    '--host', '127.0.0.1', '--port', '4173', '--strictPort'
  ], { cwd: root, stdio: 'ignore' })
  await retry(async () => {
    const response = await fetch(previewUrl, {signal: AbortSignal.timeout(1000)})
    return response.ok
  }, 'built Vite preview')

  chrome = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + userData, 'about:blank'
  ], {stdio:'ignore'})

  const port = await retry(() => {
    try {
      const value = readFileSync(join(userData, 'DevToolsActivePort'), 'utf8')
      const first = Number(value.split('\n')[0])
      return Number.isInteger(first) && first > 0 ? first : false
    } catch { return false }
  }, 'Chromium DevTools endpoint')
  const pages = await retry(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list')
    if (!response.ok) return false
    const all = await response.json()
    return all.find(tab => tab.type === 'page' && tab.webSocketDebuggerUrl) || false
  }, 'Chromium page target')

  socket = new WebSocket(pages.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once:true})
    socket.addEventListener('error', () => reject(new Error('DevTools connection refused')), {once:true})
  })
  const pending = new Map()
  const exceptions = []
  let serial = 0
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data)
    if (packet.method === 'Runtime.exceptionThrown')
      exceptions.push(packet.params.exceptionDetails.text)
    const task = pending.get(packet.id)
    if (task) {
      pending.delete(packet.id)
      if (packet.error) task.reject(new Error(packet.error.message))
      else task.resolve(packet.result)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial
    pending.set(id, {resolve, reject})
    socket.send(JSON.stringify({id, method, params}))
  })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {
      expression, returnByValue:true, awaitPromise:true
    })
    if (response.exceptionDetails)
      throw new Error('Browser JS evaluation failed: ' + response.exceptionDetails.text)
    return response.result.value
  }
  const heading = () => evaluate("document.querySelector('main h1')?.textContent?.trim()")
  const click = async label => {
    const matched = await evaluate(`(() => {
      const button = [...document.querySelectorAll('nav button')]
        .find(element => element.textContent.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`)
    if (!matched) throw new Error('Missing navigation button ' + label)
  }
  const expectPage = async (navLabel, expectedHeading) => {
    await click(navLabel)
    await retry(async () => (await heading()) === expectedHeading,
      navLabel + ' navigation')
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', {url: previewUrl})
  await retry(async () => (await heading()) === 'Overview', 'Overview heading')
  if (!await evaluate("document.body.textContent.includes('Connect to your gateway')"))
    throw new Error('Offline credential notice is missing')

  await expectPage('Models', 'Models')
  if (!await evaluate("document.body.textContent.includes('Model registry')"))
    throw new Error('Model registry panel missing')
  await expectPage('Control', 'Central AI server')
  if (!await evaluate("document.body.textContent.includes('LAN client keys')"))
    throw new Error('Local client management panel missing')
  await expectPage('Playground', 'Playground')
  if (!await evaluate("!!document.querySelector('form.composer textarea')"))
    throw new Error('Chat composer missing')
  await expectPage('Settings', 'Settings')
  if (!await evaluate("!!document.querySelector('input#api-key[type=password]')"))
    throw new Error('Password-masked API credential field missing')
  if (exceptions.length)
    throw new Error('Uncaught errors in browser runtime: ' + exceptions.join('; '))

  console.log('PASS: built Console loaded and offline Overview, Models, Control, Playground, Settings navigated')
}

main().catch(error => {
  console.error('Console browser regression FAILED:', error.message)
  process.exitCode = 1
}).finally(() => {
  socket?.close()
  chrome?.kill()
  server?.kill()
  rmSync(userData, {recursive:true, force:true})
})
