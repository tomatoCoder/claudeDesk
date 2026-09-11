import type { ThemePreference } from '../domain/models'

export function applyTheme(preference: ThemePreference, systemPrefersDark: boolean) {
  const resolved = preference === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : preference
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}
