export function isFilesShortcut(event: KeyboardEvent, blocked = false) {
  if (blocked || event.isComposing) return false
  if (event.key.toLowerCase() !== 'p' || event.altKey || event.shiftKey) return false
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey)
}
