function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 会话列表时间：今天 HH:mm / 昨天 / MM-DD */
export function listTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (isSameDay(d, now)) return hhmm(d)
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (isSameDay(d, yesterday)) return '昨天'
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 聊天区时间分隔条：今天只显示时分，跨天带日期 */
export function separatorTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (isSameDay(d, now)) return hhmm(d)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${hhmm(d)}`
}
