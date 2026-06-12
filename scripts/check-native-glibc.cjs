#!/usr/bin/env node

const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const nodePath =
  process.argv[2] ||
  'release/linux-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
const limit = process.argv[3] || 'GLIBC_2.28'

function parseVersion(value) {
  return value.replace(/^GLIBC_/, '').split('.').map((part) => Number(part))
}

function compareVersions(a, b) {
  const av = parseVersion(a)
  const bv = parseVersion(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i++) {
    const diff = (av[i] || 0) - (bv[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

if (!existsSync(nodePath)) {
  console.error(`[glibc-check] 未找到 native 模块：${nodePath}`)
  process.exit(1)
}

const result = spawnSync('strings', [nodePath], { encoding: 'utf8' })
if (result.error) {
  console.error(`[glibc-check] 无法执行 strings：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(result.stderr || `[glibc-check] strings 退出码 ${result.status}`)
  process.exit(result.status || 1)
}

const versions = Array.from(new Set(result.stdout.match(/GLIBC_[0-9]+(?:\.[0-9]+)+/g) || []))
  .sort(compareVersions)

if (versions.length === 0) {
  console.error(`[glibc-check] 未在 ${nodePath} 中找到 GLIBC 版本符号`)
  process.exit(1)
}

const highest = versions[versions.length - 1]
console.log(`[glibc-check] ${nodePath}`)
console.log(`[glibc-check] GLIBC symbols: ${versions.join(', ')}`)
console.log(`[glibc-check] highest=${highest}, limit=${limit}`)

if (compareVersions(highest, limit) > 0) {
  console.error(`[glibc-check] 失败：${highest} 超过 UOS20/Debian10 基线 ${limit}`)
  process.exit(1)
}
