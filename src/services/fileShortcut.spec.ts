// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isFilesShortcut } from './fileShortcut'

function key(overrides: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent('keydown', { key: 'p', metaKey: true, ...overrides })
}

describe('isFilesShortcut', () => {
  it('accepts Command+P and Ctrl+P', () => {
    expect(isFilesShortcut(key())).toBe(true)
    expect(isFilesShortcut(key({ metaKey: false, ctrlKey: true }))).toBe(true)
  })

  it('rejects modified, composing, and blocked shortcuts', () => {
    expect(isFilesShortcut(key({ shiftKey: true }))).toBe(false)
    expect(isFilesShortcut(key({ altKey: true }))).toBe(false)
    expect(isFilesShortcut(key({ isComposing: true }))).toBe(false)
    expect(isFilesShortcut(key(), true)).toBe(false)
    expect(isFilesShortcut(new KeyboardEvent('keydown', { key: 'o', metaKey: true }))).toBe(false)
  })
})
