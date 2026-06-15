import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'src/renderer/public/ocr')

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'core/tesseract-core-simd-lstm.wasm.js'
  ],
  ['node_modules/tesseract.js-core/tesseract-core.wasm', 'core/tesseract-core.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm', 'core/tesseract-core-simd.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
    'core/tesseract-core-simd-lstm.wasm'
  ],
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  [
    'node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz',
    'lang/chi_sim.traineddata.gz'
  ]
]

function shouldCopy(src, dest) {
  if (!existsSync(dest)) return true
  const srcStat = statSync(src)
  const destStat = statSync(dest)
  return srcStat.size !== destStat.size || srcStat.mtimeMs > destStat.mtimeMs
}

for (const [srcRel, destRel] of files) {
  const src = join(root, srcRel)
  const dest = join(out, destRel)
  if (!existsSync(src)) {
    throw new Error(`OCR 资源缺失：${srcRel}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  if (shouldCopy(src, dest)) copyFileSync(src, dest)
}

console.log(`[ocr-assets] ready: ${out}`)
