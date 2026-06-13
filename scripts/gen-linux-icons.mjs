// 生成 Linux 桌面多尺寸图标（决议 #58）：从品牌 512px png 缩放出 hicolor 全尺寸，
// electron-builder linux.icon 指向 build/icons/linux 目录后会按文件名装入
// /usr/share/icons/hicolor/<N>x<N>/apps/，DDE / GNOME 开始菜单按主题取用。
// 产物提交仓库；脚本依赖 macOS 自带 sips，仅需在开发机重新生成图标时运行。
// 用法：node scripts/gen-linux-icons.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'build/icons/pantry-logo-icon.png')
const outDir = join(root, 'build/icons/linux')
mkdirSync(outDir, { recursive: true })

const SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512]
for (const size of SIZES) {
  const out = join(outDir, `${size}x${size}.png`)
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', out], { stdio: 'pipe' })
  console.log(`已生成 ${out}`)
}
