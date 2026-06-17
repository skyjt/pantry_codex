import { isAbsolute, relative, resolve } from 'node:path'

export function isPathInside(path: string, root: string): boolean {
  const target = resolve(path)
  const base = resolve(root)
  const rel = relative(base, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export function isPathInsideAny(path: string, roots: string[]): boolean {
  return roots.some((root) => isPathInside(path, root))
}

export class PathGrantStore {
  private readonly grants = new Map<string, number>()

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now = () => Date.now()
  ) {}

  grant(ownerId: number, paths: string[]): void {
    const expiresAt = this.now() + this.ttlMs
    for (const path of paths) {
      this.grants.set(this.key(ownerId, path), expiresAt)
    }
  }

  consume(ownerId: number, paths: string[]): boolean {
    this.prune()
    const keys = paths.map((path) => this.key(ownerId, path))
    if (!keys.every((key) => this.grants.has(key))) return false
    for (const key of keys) this.grants.delete(key)
    return true
  }

  private prune(): void {
    const now = this.now()
    for (const [key, expiresAt] of this.grants) {
      if (expiresAt <= now) this.grants.delete(key)
    }
  }

  private key(ownerId: number, path: string): string {
    return `${ownerId}\0${resolve(path)}`
  }
}
