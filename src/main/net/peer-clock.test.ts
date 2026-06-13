import { describe, expect, it } from 'vitest'
import { PeerClock } from './peer-clock'

describe('PeerClock 时钟偏移矫正（决议 #65）', () => {
  it('首次观测取原始偏移，后续 EMA 平滑', () => {
    const c = new PeerClock()
    c.observe('a', 1000, 6000) // raw = 6000 - 1000 = 5000（对方钟慢 5s）
    expect(c.offsetOf('a')).toBe(5000)
    c.observe('a', 3000, 6000) // raw = 3000 → 5000*0.7 + 3000*0.3 = 4400
    expect(c.offsetOf('a')).toBe(4400)
  })

  it('correct 把对方时间换算到本机钟', () => {
    const c = new PeerClock()
    c.observe('a', 1000, 6000) // offset +5000
    // 对方发于其钟 3000 的消息，本机视角 = 3000 + 5000 = 8000
    expect(c.correct('a', 3000, 100000)).toBe(8000)
  })

  it('上界钳到 localNow，杜绝来自未来的显示时间', () => {
    const c = new PeerClock()
    c.observe('a', 1000, 6000) // offset +5000
    expect(c.correct('a', 3000, 7000)).toBe(7000) // 8000 > 7000 → 钳到 7000
    // 未知节点：偏移 0，对方钟超前也钳到本机当前
    expect(c.correct('x', 9999, 9000)).toBe(9000)
  })

  it('未观测节点偏移为 0，退回原始时间（不劣于改动前）', () => {
    const c = new PeerClock()
    expect(c.offsetOf('x')).toBe(0)
    expect(c.correct('x', 5000, 9000)).toBe(5000)
  })

  it('忽略非法时间戳', () => {
    const c = new PeerClock()
    c.observe('a', 0, 5000)
    c.observe('a', NaN, 5000)
    expect(c.offsetOf('a')).toBe(0)
    expect(c.correct('a', 0, 5000)).toBe(0)
  })
})
