// 语义化版本比较（决议 #166 局域网自更新择源用）。纯函数、零依赖，可直接 vitest。
// 仅取 主/次/补丁 三段，忽略预发布/构建元数据；非法或缺失段按 0 处理。

function parseVer(v: string): [number, number, number] {
  const parts = String(v ?? '')
    .trim()
    .split('.')
    .slice(0, 3)
    .map((s) => {
      const n = parseInt(s, 10)
      return Number.isFinite(n) && n >= 0 ? n : 0
    })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** a>b 返回 1，a<b 返回 -1，相等返回 0（按数值逐段比较，非字典序）。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/** candidate 是否严格新于 base。 */
export function isNewer(candidate: string, base: string): boolean {
  return compareSemver(candidate, base) > 0
}
