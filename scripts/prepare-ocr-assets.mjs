import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'src/renderer/public/ocr')

// OCR 资源（纯本地、不联网，决议 #158）：
// - PP-OCRv6_tiny 检测/识别 ONNX + 字典：仓库内 build/ocr/（git 跟踪，CI 直接可用）。
// - onnxruntime-web 的 wasm 运行时：随 npm 包就位，构建时从 node_modules 取。
const files = [
  ['build/ocr/PP-OCRv6_tiny_det.onnx', 'PP-OCRv6_tiny_det.onnx'],
  ['build/ocr/PP-OCRv6_tiny_rec.onnx', 'PP-OCRv6_tiny_rec.onnx'],
  ['build/ocr/ppocrv6_dict.txt', 'ppocrv6_dict.txt'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs']
]

// 清理历史残留（旧 tesseract 的 core/ lang/ worker.min.js），避免打进产物。
for (const stale of ['core', 'lang', 'worker.min.js']) {
  const stalePath = join(out, stale)
  if (existsSync(stalePath)) rmSync(stalePath, { recursive: true, force: true })
}

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
