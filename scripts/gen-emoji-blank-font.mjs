// 生成输入框等宽空白字形字体 PantryEmojiBlank（决议 #56）。
// 目的：聊天输入框 textarea 的 font-family 首位使用本字体，让内置 emoji 子集的
// 字符在三平台（mac/Win7/UOS）都精确占 1.3em advance——镜像层 Twemoji 图标恰好
// 满槽，与光标逐字符对齐、连续输入不重叠，不再依赖系统 emoji 字体的宽度。
// 产物 src/renderer/src/assets/fonts/pantry-emoji-blank.ttf 提交仓库；
// 扩充 COMPAT_EMOJIS 后必须重跑本脚本（vitest 有 cmap 覆盖测试兜底）。
// 用法：node scripts/gen-emoji-blank-font.mjs
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'

const { Font, Glyph, Path } = opentype

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// COMPAT_EMOJIS 唯一来源是 renderer 的 TS 模块 —— esbuild 转 cjs 后读取，避免码点表两处维护
buildSync({
  entryPoints: [join(root, 'src/renderer/src/utils/compat-emoji.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: join(root, 'out/compat-emoji.cjs'),
  logLevel: 'warning'
})
const require = createRequire(import.meta.url)
const { COMPAT_EMOJIS } = require(join(root, 'out/compat-emoji.cjs'))

const UNITS_PER_EM = 1000
const EM_ADVANCE = 1300 // 1.3em，与消息正文 CompatEmoji 同尺度（ui-design §9）
const ZERO_WIDTH = new Set([0xfe0f, 0x200d]) // 变体选择符 / ZWJ：零宽，不破坏序列总宽

const codepoints = new Set()
for (const item of COMPAT_EMOJIS) {
  for (const ch of Array.from(item.char)) codepoints.add(ch.codePointAt(0))
}
for (const cp of ZERO_WIDTH) codepoints.add(cp)

const notdef = new Glyph({ name: '.notdef', unicode: 0, advanceWidth: 650, path: new Path() })
const glyphs = [notdef]
for (const cp of [...codepoints].sort((a, b) => a - b)) {
  glyphs.push(
    new Glyph({
      name: `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      unicode: cp,
      advanceWidth: ZERO_WIDTH.has(cp) ? 0 : EM_ADVANCE,
      path: new Path() // 空轮廓：可见图形由镜像层 Twemoji 提供
    })
  )
}

const font = new Font({
  familyName: 'PantryEmojiBlank',
  styleName: 'Regular',
  unitsPerEm: UNITS_PER_EM,
  ascender: 800,
  descender: -200,
  glyphs
})

const outFile = join(root, 'src/renderer/src/assets/fonts/pantry-emoji-blank.ttf')
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, Buffer.from(font.toArrayBuffer()))
console.log(`已生成 ${outFile}（${glyphs.length} 字形，含 .notdef）`)
