// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsView from './SettingsView.vue'

const settings = {
  values: {
    authToken: 'token-secret',
    baseUrl: 'https://gateway.example.com',
    model: 'gateway-sonnet',
  },
  version: 'v1',
  path: '/Users/test/.claude/settings.json',
}

describe('SettingsView', () => {
  it('展示三个受管理字段并默认遮住 Token', () => {
    const wrapper = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' } },
    })

    expect(wrapper.get('input[name="ANTHROPIC_AUTH_TOKEN"]').attributes('type')).toBe('password')
    expect((wrapper.get('input[name="ANTHROPIC_BASE_URL"]').element as HTMLInputElement).value).toBe('https://gateway.example.com')
    expect((wrapper.get('input[name="ANTHROPIC_MODEL"]').element as HTMLInputElement).value).toBe('gateway-sonnet')
  })

  it('保存时携带加载版本以阻止覆盖外部修改', async () => {
    const wrapper = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' } },
    })
    await wrapper.get('input[name="ANTHROPIC_MODEL"]').setValue('next-model')
    await wrapper.get('button[type="submit"]').trigger('submit')

    expect(wrapper.emitted('save')?.[0]).toEqual([{
      version: 'v1',
      values: { authToken: 'token-secret', baseUrl: 'https://gateway.example.com', model: 'next-model' },
    }])
  })
})
