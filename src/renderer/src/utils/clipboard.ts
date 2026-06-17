export interface ClipboardTextSource {
  getData(type: string): string
}

export function hasClipboardText(data: ClipboardTextSource): boolean {
  return data.getData('text/plain').length > 0
}

export function imageMimeFromExt(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}
