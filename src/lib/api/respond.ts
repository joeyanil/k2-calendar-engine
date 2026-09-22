import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, isAppError } from '../errors/AppError'

/**
 * The standard response envelope, matching 04_API_Specification.md's
 * documented shape: `{ success, data }` on the happy path, `{ success,
 * error: { code, message, details } }` on failure. Every Calendar Engine
 * Route Handler responds through these two helpers — never builds its own
 * ad hoc JSON shape (mission §43: "Use stable DTO/request/response
 * structures").
 */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

/**
 * Wraps a Route Handler body, converting any thrown `AppError` (or Zod
 * validation error) into the standard error envelope with the right HTTP
 * status — the single place this mapping happens, so individual routes
 * stay thin (mission §43's "a Route Handler file is thin — parse, call one
 * service method, respond").
 */
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message, details: err.details } },
        { status: err.httpStatus },
      )
    }
    if (err instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body.', details: err.flatten() } },
        { status: 422 },
      )
    }
    // Never leak an unhandled error's internals to the client (mission
    // §44's "secure error handling") — log server-side, respond generically.
    console.error('[calendar-api] unhandled error', err)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}

export { AppError }
