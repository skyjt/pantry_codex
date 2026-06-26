// 运行形态自检（决议 #166 局域网自更新）。纯函数：不 import electron，
// 由调用方（index.ts）注入 isPackaged / platform / env，便于 vitest。
//
// portable（Windows）运行时 electron-builder 注入 PORTABLE_EXECUTABLE_FILE；
// AppImage（Linux）运行时注入 APPIMAGE。据此与安装版（nsis / deb）区分。

export type ReleaseFormat = 'nsis' | 'portable' | 'deb' | 'appimage' | 'mac' | 'dev' | 'unknown'

export interface FormatProbe {
  /** process.platform */
  platform: NodeJS.Platform
  /** app.isPackaged */
  isPackaged: boolean
  /** process.env（读 PORTABLE_EXECUTABLE_FILE / APPIMAGE 标记） */
  env: NodeJS.ProcessEnv
}

/** 判定当前可执行产物的分发形态。 */
export function detectReleaseFormat({ platform, isPackaged, env }: FormatProbe): ReleaseFormat {
  if (!isPackaged) return 'dev'
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis'
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb'
  if (platform === 'darwin') return 'mac'
  return 'unknown'
}

/**
 * 本期（决议 #166 第一阶段）可作为局域网更新源的形态：Windows 安装版（nsis，安装时
 * 自留安装器）与 Linux deb（运行态 dpkg-deb 自重打包）。绿色版（portable / AppImage）
 * 机制上同样适用、mac 暂缓，故本期不声明 upd1。
 */
export function canServeUpdates(probe: FormatProbe): boolean {
  const fmt = detectReleaseFormat(probe)
  return fmt === 'nsis' || fmt === 'deb'
}
