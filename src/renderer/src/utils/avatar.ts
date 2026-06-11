export const BUILTIN_AVATARS = ['茶', '竹', '山', '云', '星', '灯', '书', '墨']

export function avatarText(avatar: number, displayName: string): string {
  if (avatar >= 0) return BUILTIN_AVATARS[avatar % BUILTIN_AVATARS.length]
  return displayName.trim().slice(0, 1) || '茶'
}
