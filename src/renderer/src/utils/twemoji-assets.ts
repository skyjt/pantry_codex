const TWEMOJI_ASSETS = import.meta.glob('../assets/twemoji/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export function emojiToTwemojiCode(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)?.toString(16) ?? '')
    .filter((code) => code && code !== 'fe0f')
    .join('-')
}

export function twemojiUrl(code: string): string {
  return TWEMOJI_ASSETS[`../assets/twemoji/${code}.svg`] ?? ''
}
