// CIDR 网段解析（F-DISC-2 第二板斧：网段定向扫描）。
// 只支持 IPv4；最多展开 1024 个主机地址（/22 及更小），防误填大段打爆网络。

export const SCAN_MAX_HOSTS = 1024

export function parseCidr(input: string): string[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(input.trim())
  if (!m) return null
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const prefix = Number(m[5])
  if (octets.some((o) => o > 255) || prefix < 8 || prefix > 30) return null

  const hostBits = 32 - prefix
  const hostCount = 2 ** hostBits - 2 // 去掉网络地址与广播地址
  if (hostCount <= 0 || hostCount > SCAN_MAX_HOSTS) return null

  const base =
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const network = (base >> hostBits << hostBits) >>> 0

  const hosts: string[] = []
  for (let i = 1; i <= hostCount; i++) {
    const addr = (network + i) >>> 0
    hosts.push(
      `${(addr >>> 24) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 8) & 0xff}.${addr & 0xff}`
    )
  }
  return hosts
}
