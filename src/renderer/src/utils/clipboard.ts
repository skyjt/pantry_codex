export interface ClipboardTextSource {
  getData(type: string): string
}

export function hasClipboardText(data: ClipboardTextSource): boolean {
  return data.getData('text/plain').length > 0
}

export const NATIVE_IMAGE_FALLBACK_SUPPRESS_MS = 300

export function shouldSuppressNativeImageFallback(
  lastPasteHandledAt: number,
  now = Date.now()
): boolean {
  return (
    lastPasteHandledAt > 0 &&
    now >= lastPasteHandledAt &&
    now - lastPasteHandledAt < NATIVE_IMAGE_FALLBACK_SUPPRESS_MS
  )
}

export function imageMimeFromExt(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}
