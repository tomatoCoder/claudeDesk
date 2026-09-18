export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function asAppError(cause: unknown, code = 'internal_error', message = '操作失败') {
  if (cause instanceof AppError) return cause
  return new AppError(code, cause instanceof Error ? cause.message : message, false)
}
