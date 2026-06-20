import type { ImageOcrSource } from '../../../shared/ipc'
import { PaddleOcrService, type OrtModule, type RecognitionResult } from './paddleocr'

export const OCR_AUTO_MAX_PIXELS = 1_500_000
export const OCR_AUTO_MAX_BYTES = 3 * 1024 * 1024

// 超大图先降采样：省内存、提速；PaddleOCR 检测内部还会缩到 960，识别用此分辨率裁剪。
const OCR_MAX_SIDE = 2200
// PaddleOCR 置信度为 0~1，低于此判为误检丢弃。
const OCR_MIN_CONFIDENCE = 0.3

// public/ocr/ 下的模型与 onnxruntime wasm —— 由 scripts/prepare-ocr-assets.mjs 就位，纯本地、不联网。
const OCR_ASSET_BASE = 'ocr/'
const OCR_DET_MODEL = `${OCR_ASSET_BASE}PP-OCRv6_tiny_det.onnx`
const OCR_REC_MODEL = `${OCR_ASSET_BASE}PP-OCRv6_tiny_rec.onnx`
const OCR_DICT_PATH = `${OCR_ASSET_BASE}ppocrv6_dict.txt`

export interface OcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrToken {
  id: string
  text: string
  confidence: number
  bbox: OcrBox
  lineIndex: number
  wordIndex: number
  tokenIndex: number
}

export interface OcrLine {
  id: string
  text: string
  bbox: OcrBox
  tokenIds: string[]
  lineIndex: number
}

export interface OcrResult {
  text: string
  tokens: OcrToken[]
  lines: OcrLine[]
  scale: number
}

type ProgressListener = (progress: number, status: string) => void

interface PreparedImage {
  width: number
  height: number
  data: Uint8Array
  scale: number
}

const resultCache = new Map<string, OcrResult>()
let servicePromise: Promise<PaddleOcrService> | null = null

export function getCachedOcrResult(cacheKey: string): OcrResult | null {
  return resultCache.get(cacheKey) ?? null
}

export function isAutoOcrCandidate(width: number, height: number, bytes: number): boolean {
  return width * height <= OCR_AUTO_MAX_PIXELS && bytes <= OCR_AUTO_MAX_BYTES
}

export function getSelectedOcrText(tokens: OcrToken[], selectedIds: Set<string>): string {
  const selected = tokens
    .filter((token) => selectedIds.has(token.id))
    .sort((a, b) => a.lineIndex - b.lineIndex || a.tokenIndex - b.tokenIndex)
  if (selected.length === 0) return ''

  const lines: string[] = []
  let currentLine = selected[0].lineIndex
  let lineText = ''
  let previousToken: OcrToken | null = null

  for (const token of selected) {
    if (token.lineIndex !== currentLine) {
      if (lineText.trim()) lines.push(lineText.trim())
      currentLine = token.lineIndex
      lineText = ''
      previousToken = null
    }
    lineText += shouldInsertSpace(previousToken, token) ? ` ${token.text}` : token.text
    previousToken = token
  }
  if (lineText.trim()) lines.push(lineText.trim())
  return lines.join('\n')
}

export function getOcrResultText(result: OcrResult): string {
  const text = result.text.trim()
  if (text) return text
  return getSelectedOcrText(result.tokens, new Set(result.tokens.map((token) => token.id))).trim()
}

export async function recognizeImageText(params: {
  cacheKey: string
  source: ImageOcrSource
  naturalWidth: number
  naturalHeight: number
  onProgress: ProgressListener
}): Promise<OcrResult> {
  const cached = resultCache.get(params.cacheKey)
  if (cached) {
    params.onProgress(1, 'cached')
    return cached
  }

  params.onProgress(0, 'preparing image')
  const prepared = await prepareImageForOcr(
    params.source.bytes,
    params.source.name,
    params.naturalWidth,
    params.naturalHeight
  )

  params.onProgress(0.05, 'initializing models')
  const service = await getService()

  params.onProgress(0.1, 'recognizing text')
  const results = await service.recognize(
    { width: prepared.width, height: prepared.height, data: prepared.data },
    {
      onProgress: (event) => {
        const frac = event.progress.total > 0 ? event.progress.current / event.progress.total : 0
        // 检测占 0.1~0.3，识别占 0.3~0.95
        const progress = event.type === 'det' ? 0.1 + frac * 0.2 : 0.3 + frac * 0.65
        params.onProgress(progress, 'recognizing text')
      }
    }
  )

  const result = toOcrResult(results, prepared.scale)
  resultCache.set(params.cacheKey, result)
  params.onProgress(1, 'ready')
  return result
}

async function getService(): Promise<PaddleOcrService> {
  if (!servicePromise) {
    servicePromise = createService()
  }
  return servicePromise
}

async function createService(): Promise<PaddleOcrService> {
  // onnxruntime-web：纯本地 wasm，单线程主线程跑（规避 worker / SharedArrayBuffer / COOP-COEP），
  // wasm 文件由 prepare-ocr-assets 放到 public/ocr/，与渲染入口同源。
  // 动态 import：把 ort + wasm 切到按需 chunk，首屏不加载；测试加载本模块也不会触发 ort。
  const ort = await import('onnxruntime-web')
  ort.env.wasm.wasmPaths = OCR_ASSET_BASE
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false

  const [detBuffer, recBuffer, dictText] = await Promise.all([
    fetchArrayBuffer(OCR_DET_MODEL),
    fetchArrayBuffer(OCR_REC_MODEL),
    fetchText(OCR_DICT_PATH)
  ])

  // PaddleOCR CTC 约定：index 0 是 blank 占位，字典末尾补一个空格类。
  const chars = dictText.replace(/\n+$/, '').split('\n')
  const charactersDictionary = ['', ...chars, ' ']

  return PaddleOcrService.createInstance({
    ort: ort as unknown as OrtModule,
    detection: { modelBuffer: detBuffer },
    recognition: { modelBuffer: recBuffer, charactersDictionary }
  })
}

async function fetchArrayBuffer(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`OCR 资源加载失败：${path}`)
  return res.arrayBuffer()
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`OCR 资源加载失败：${path}`)
  return res.text()
}

// PaddleOCR 输出按行（检测框 + 整行文字），转成既有 OcrResult 结构；
// 当前界面只消费整段 text，token/line 以行粒度填充，保持缓存 IPC 结构完整。
function toOcrResult(results: RecognitionResult[], scale: number): OcrResult {
  const divisor = scale > 0 ? scale : 1
  const tokens: OcrToken[] = []
  const lines: OcrLine[] = []
  const textLines: string[] = []

  let lineIndex = 0
  for (const item of results) {
    const text = normalizeText(item.text)
    if (!text || item.confidence < OCR_MIN_CONFIDENCE) continue
    // 还原到原图坐标（PaddleOCR 坐标相对降采样后的图）。
    const bbox: OcrBox = {
      x0: item.box.x / divisor,
      y0: item.box.y / divisor,
      x1: (item.box.x + item.box.width) / divisor,
      y1: (item.box.y + item.box.height) / divisor
    }
    const tokenId = `ocr-${lineIndex}`
    tokens.push({
      id: tokenId,
      text,
      confidence: Math.round(item.confidence * 100),
      bbox,
      lineIndex,
      wordIndex: 0,
      tokenIndex: lineIndex
    })
    lines.push({ id: `line-${lineIndex}`, text, bbox, tokenIds: [tokenId], lineIndex })
    textLines.push(text)
    lineIndex += 1
  }

  return { text: textLines.join('\n'), tokens, lines, scale: 1 }
}

async function prepareImageForOcr(
  bytes: ArrayBuffer,
  name: string,
  naturalWidth: number,
  naturalHeight: number
): Promise<PreparedImage> {
  const blob = new Blob([bytes], { type: mimeFromName(name) })
  const { source, width: natW, height: natH } = await decodeImage(blob, naturalWidth, naturalHeight)
  const longestSide = Math.max(natW, natH) || 1
  const scale = longestSide <= OCR_MAX_SIDE ? 1 : OCR_MAX_SIDE / longestSide
  const width = Math.max(1, Math.round(natW * scale))
  const height = Math.max(1, Math.round(natH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    if (source instanceof ImageBitmap) source.close()
    throw new Error('OCR 图片预处理失败')
  }
  ctx.drawImage(source, 0, 0, width, height)
  if (source instanceof ImageBitmap) source.close()
  const imageData = ctx.getImageData(0, 0, width, height)
  return { width, height, data: new Uint8Array(imageData.data.buffer), scale }
}

async function decodeImage(
  blob: Blob,
  fallbackWidth: number,
  fallbackHeight: number
): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob)
    return { source: bitmap, width: bitmap.width, height: bitmap.height }
  } catch {
    const image = await loadBlobImage(blob)
    return {
      source: image,
      width: image.naturalWidth || fallbackWidth,
      height: image.naturalHeight || fallbackHeight
    }
  }
}

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('OCR 图片解码失败'))
    }
    image.src = url
  })
}

function normalizeText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function shouldInsertSpace(previous: OcrToken | null, next: OcrToken): boolean {
  if (!previous || !next) return false
  if (previous.wordIndex === next.wordIndex) return false
  return /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(next.text)
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'image/png'
}
