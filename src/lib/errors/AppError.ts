/**
 * AppError — reused verbatim from 06_Backend_Architecture.md §5.1. The
 * Calendar Engine does not define its own error class; it throws this one
 * with codes from the shared taxonomy (codes.ts), exactly like every other
 * K2 subsystem.
 */
export class AppError extends Error {
  constructor(
    public code: string, // e.g. 'CALENDAR_EXAM_ON_WEEKEND'
    public httpStatus: number, // e.g. 422
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
