import { describe, expect, it } from 'vitest'
import { parseBridgeRequest, parseRunControl, serializeBridgeEvent } from './protocol.js'

describe('Bridge 协议', () => {
  it('拒绝未知协议版本，防止错误的进程互操作', () => {
    expect(() => parseBridgeRequest('{"v":2,"type":"handshake","requestId":"r1","claudePath":"/bin/claude"}'))
      .toThrow(/协议版本/)
  })

  it('拒绝缺少绝对 Claude 路径的握手', () => {
    expect(() => parseBridgeRequest('{"v":1,"type":"handshake","requestId":"r1","claudePath":"claude"}'))
      .toThrow(/绝对路径/)
  })

  it('序列化事件时保留版本、请求和轮次标识', () => {
    expect(serializeBridgeEvent({
      v: 1,
      type: 'run.status',
      requestId: 'request-1',
      runId: 'run-1',
      sequence: 4,
      status: 'running',
    })).toBe('{"v":1,"type":"run.status","requestId":"request-1","runId":"run-1","sequence":4,"status":"running"}\n')
  })

  it('解析带调整标识的运行中指令', () => {
    expect(parseRunControl(JSON.stringify({
      v: 1,
      type: 'run.adjust',
      runId: 'run-1',
      adjustmentId: '11111111-1111-4111-8111-111111111111',
      text: '先停止修改配置，改为补测试',
    }))).toMatchObject({ type: 'run.adjust', runId: 'run-1', text: '先停止修改配置，改为补测试' })
  })

  it('拒绝空白的运行中调整', () => {
    expect(() => parseRunControl(JSON.stringify({
      v: 1, type: 'run.adjust', runId: 'run-1', adjustmentId: 'a1', text: '   ',
    }))).toThrow(/不能为空/)
  })

  it('拒绝缺少行为的权限控制消息', () => {
    expect(() => parseRunControl(JSON.stringify({
      v: 1, type: 'permission.resolve', runId: 'run-1', permissionId: 'permission-1',
    }))).toThrow(/behavior/)
  })

  it('拒绝未知行为的权限控制消息', () => {
    expect(() => parseRunControl(JSON.stringify({
      v: 1, type: 'permission.resolve', runId: 'run-1', permissionId: 'permission-1', behavior: 'defer',
    }))).toThrow(/behavior/)
  })
})
