'use strict'

// Safe Markdown subset: create DOM nodes from text; never assign model output
// to innerHTML. Supports fenced code, headings, lists, inline code and emphasis.
;(function () {
  function inline(target, input) {
    const pattern = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\))/g
    let last = 0
    for (const match of input.matchAll(pattern)) {
      const start = match.index
      if (start > last) target.append(document.createTextNode(input.slice(last, start)))
      let node
      if (match[2]) {
        node = document.createElement('strong')
        node.textContent = match[2]
      } else if (match[3]) {
        node = document.createElement('code')
        node.textContent = match[3]
      } else if (match[4]) {
        node = document.createElement('em')
        node.textContent = match[4]
      } else {
        try {
          const url = new URL(match[6])
          if (url.protocol !== 'https:') throw Error('Unsafe scheme')
          node = document.createElement('a')
          node.textContent = match[5]
          node.href = url.href
          node.target = '_blank'
          node.rel = 'noopener noreferrer'
        } catch {
          node = document.createTextNode(match[0])
        }
      }
      target.append(node)
      last = start + match[0].length
    }
    if (last < input.length) target.append(document.createTextNode(input.slice(last)))
  }

  function render(target, text) {
    target.replaceChildren()
    const lines = String(text).split(/\r?\n/)
    let index = 0
    while (index < lines.length) {
      const line = lines[index]
      const fence = /^```([\w+-]{0,25})\s*$/.exec(line)
      if (fence) {
        index++
        const code = []
        while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++])
        if (index < lines.length) index++
        const container = document.createElement('div')
        container.className = 'code-block'
        const header = document.createElement('div')
        header.className = 'code-header'
        const label = document.createElement('span')
        label.textContent = fence[1] || 'text'
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.textContent = 'Copy'
        copy.className = 'code-copy'
        copy.addEventListener('click', () => {
          navigator.clipboard.writeText(code.join('\n')).then(
            () => { copy.textContent = 'Copied' },
            () => { copy.textContent = 'Unavailable' }
          )
        })
        header.append(label, copy)
        const pre = document.createElement('pre')
        const source = document.createElement('code')
        source.textContent = code.join('\n')
        pre.append(source)
        container.append(header, pre)
        target.append(container)
        continue
      }
      if (!line.trim()) { index++; continue }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line)
      if (heading) {
        const h = document.createElement('h' + (heading[1].length + 2))
        inline(h, heading[2])
        target.append(h)
        index++
        continue
      }
      const list = /^(\s*[-*]|\s*\d+\.)\s+(.+)$/.exec(line)
      if (list) {
        const ordered = /^\s*\d+\./.test(line)
        const root = document.createElement(ordered ? 'ol' : 'ul')
        while (index < lines.length) {
          const item = /^(\s*[-*]|\s*\d+\.)\s+(.+)$/.exec(lines[index])
          if (!item || /^\s*\d+\./.test(lines[index]) !== ordered) break
          const li = document.createElement('li')
          inline(li, item[2])
          root.append(li)
          index++
        }
        target.append(root)
        continue
      }
      const p = document.createElement('p')
      const paragraph = []
      while (index < lines.length && lines[index].trim() &&
          !/^```/.test(lines[index]) && !/^#{1,3}\s+/.test(lines[index]) &&
          !/^(\s*[-*]|\s*\d+\.)\s+/.test(lines[index])) {
        paragraph.push(lines[index++])
      }
      if (!paragraph.length) { index++; continue }
      inline(p, paragraph.join('\n'))
      target.append(p)
    }
  }

  window.YagMarkdown = Object.freeze({ render })
})()
