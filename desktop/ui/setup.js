'use strict'

// First-run flow does not persist client credentials or chat data.
// Only a completion boolean and optional non-secret Host origin are stored.
;(function () {
  const doneKey = 'yag.desktop.setupComplete.v1'
  function shouldWelcome(storage) {
    try {
      return storage.getItem(doneKey) !== 'true' &&
        !storage.getItem('yag.desktop.url')
    } catch { return true }
  }
  function markComplete(storage) {
    try { storage.setItem(doneKey, 'true'); return true }
    catch { return false }
  }
  function transition(step, action) {
    if (step === 'welcome' && action === 'begin') return 'connect'
    if (step === 'connect' && action === 'authenticated') return 'done'
    if (step === 'done' && action === 'finish') return 'closed'
    if (action === 'skip') return 'closed'
    return step
  }
  window.YagSetup = Object.freeze({shouldWelcome, markComplete, transition})
})()
