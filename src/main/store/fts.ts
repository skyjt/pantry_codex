// 中文全文检索的"笨而可靠"方案（tech-design §5）：
// FTS5 不会切中文词 → 入库与查询都按"中文单字、ASCII 连续串"切分，查询用短语匹配。
// 纯函数，零依赖，main 与测试共用。

const CJK = /[㐀-䶿一-鿿豈-﫿]/

/** 把原文切成 FTS5 友好的 token 序列（空格分隔） */
export function toFtsTokens(text: string): string {
  const tokens: string[] = []
  let ascii = ''
  for (const ch of text) {
    if (CJK.test(ch)) {
      if (ascii) {
        tokens.push(ascii)
        ascii = ''
      }
      tokens.push(ch)
    } else if (/[0-9A-Za-z_]/.test(ch)) {
      ascii += ch.toLowerCase()
    } else {
      if (ascii) {
        tokens.push(ascii)
        ascii = ''
      }
    }
  }
  if (ascii) tokens.push(ascii)
  return tokens.join(' ')
}

/** 用户查询词 → FTS5 短语查询（"需 求 文 档"），保证连续命中 */
export function toFtsQuery(query: string): string {
  const tokens = toFtsTokens(query)
  if (!tokens) return ''
  return `"${tokens.replace(/"/g, '')}"`
}
