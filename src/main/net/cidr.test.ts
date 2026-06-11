import { describe, expect, it } from 'vitest'
import { parseCidr, SCAN_MAX_HOSTS } from './cidr'

describe('parseCidr（网段扫描）', () => {
  it('/30 展开 2 个主机（去网络与广播地址）', () => {
    expect(parseCidr('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2'])
  })

  it('/24 展开 254 个，含正确边界', () => {
    const hosts = parseCidr('10.1.2.0/24')
    expect(hosts).toHaveLength(254)
    expect(hosts?.[0]).toBe('10.1.2.1')
    expect(hosts?.[253]).toBe('10.1.2.254')
  })

  it('基址非网络地址也归一（按掩码取整）', () => {
    expect(parseCidr('192.168.1.77/30')).toEqual(['192.168.1.77', '192.168.1.78'])
  })

  it('超大段/非法输入拒绝', () => {
    expect(parseCidr('10.0.0.0/8')).toBeNull() // 超过 SCAN_MAX_HOSTS
    expect(parseCidr('10.0.0.0/21')).toBeNull() // /21 = 2046 主机，超限
    expect(parseCidr('999.0.0.1/24')).toBeNull()
    expect(parseCidr('not-a-cidr')).toBeNull()
    expect(parseCidr('10.0.0.1')).toBeNull()
  })

  it('上限恰好覆盖 /22', () => {
    const hosts = parseCidr('172.16.0.0/22')
    expect(hosts).toHaveLength(2 ** 10 - 2)
    expect((hosts?.length ?? 0) <= SCAN_MAX_HOSTS).toBe(true)
  })
})
