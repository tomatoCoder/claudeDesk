import { describe, expect, it } from 'vitest'
import { parseBridgeRequest, serializeBridgeEvent } from './protocol.js'

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
})
