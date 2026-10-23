export class DbOpenError extends Error {
  constructor(
    readonly code: 'WRONG_KEY' | 'NOT_FOUND' | 'NEWER_SCHEMA' | 'MIGRATION_FAILED',
    message: string,
    readonly details?: { version?: number },
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'DbOpenError'
  }
}
