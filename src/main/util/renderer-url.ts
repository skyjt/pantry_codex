const LOCAL_RENDERER_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function resolveDevRendererUrl(
  raw: string | undefined,
  hash = '',
  isPackaged = false
): string | null {
  if (!raw || isPackaged) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!LOCAL_RENDERER_HOSTS.has(url.hostname)) return null
    if (hash) url.hash = hash.startsWith('#') ? hash : `#${hash}`
    return url.toString()
  } catch {
    return null
  }
}
