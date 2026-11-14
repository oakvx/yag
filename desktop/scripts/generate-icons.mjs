// Generates reproducible cross-platform application icons without a binary
// asset dependency or a separately installed graphics tool.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const dir = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url))
mkdirSync(dir, { recursive: true })

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  return value >>> 0
})
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const tag = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])))
  return Buffer.concat([length, tag, data, checksum])
}
function iconPng(size) {
  const rows = Buffer.alloc(size * (1 + size * 4))
  const width = 1 + size * 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size
      const ny = (y + 0.5) / size
      const r = 0.17
      const inside = nx >= r && nx <= 1 - r || ny >= r && ny <= 1 - r ||
        (Math.hypot(nx - r, ny - r) <= r) ||
        (Math.hypot(nx - (1 - r), ny - r) <= r) ||
        (Math.hypot(nx - r, ny - (1 - r)) <= r) ||
        (Math.hypot(nx - (1 - r), ny - (1 - r)) <= r)
      const stem = Math.abs(nx - 0.5) < 0.062 && ny > 0.48 && ny < 0.78
      const left = ny >= 0.22 && ny < 0.54 && Math.abs(nx - (0.5 - (0.54 - ny) * 0.7)) < 0.063
      const right = ny >= 0.22 && ny < 0.54 && Math.abs(nx - (0.5 + (0.54 - ny) * 0.7)) < 0.063
      const letter = stem || left || right
      const rgba = !inside ? [0, 0, 0, 0] : letter ? [20, 29, 18, 255] : [185, 219, 145, 255]
      const offset = y * width + 1 + x * 4
      for (let i = 0; i < 4; i++) rows[offset + i] = rgba[i]
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
function write(name, data) { writeFileSync(join(dir, name), data) }
const png32 = iconPng(32)
const png128 = iconPng(128)
const png256 = iconPng(256)
const png512 = iconPng(512)
const png1024 = iconPng(1024)
write('32x32.png', png32)
write('128x128.png', png128)
write('128x128@2x.png', png256)

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader[6] = 0 // 256 x 256
icoHeader[7] = 0
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(png256.length, 14)
icoHeader.writeUInt32LE(22, 18)
write('icon.ico', Buffer.concat([icoHeader, png256]))

function icnsEntry(type, data) {
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([header, data])
}
const entries = Buffer.concat([
  icnsEntry('ic08', png256),
  icnsEntry('ic09', png512),
  icnsEntry('ic10', png1024)
])
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(entries.length + 8, 4)
write('icon.icns', Buffer.concat([icnsHeader, entries]))
