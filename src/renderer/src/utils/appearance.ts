import type { SettingsView } from '../../../shared/ipc'

export function applyAppearance(settings: Pick<SettingsView, 'theme' | 'fontScale'>): void {
  document.documentElement.dataset.theme = settings.theme
  const scale = settings.fontScale / 100
  document.body.style.setProperty('zoom', String(scale))
}
