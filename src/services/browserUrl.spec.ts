import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl } from './browserUrl'

describe('browser addresses', () => {
  it('loads local development servers over HTTP when no scheme is given', () => {
    expect(normalizeBrowserUrl('localhost:1420')).toBe('http://localhost:1420/')
    expect(normalizeBrowserUrl('127.0.0.1:3000/path')).toBe('http://127.0.0.1:3000/path')
    expect(normalizeBrowserUrl('[::1]:8080')).toBe('http://[::1]:8080/')
  })
  it('uses HTTPS for public hosts and preserves explicit HTTP', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
    expect(normalizeBrowserUrl('http://localhost:1420/a')).toBe('http://localhost:1420/a')
  })
  it('rejects executable and local file URLs', () => {
    for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/html,hi']) {
      expect(() => normalizeBrowserUrl(value)).toThrow()
    }
  })
})
