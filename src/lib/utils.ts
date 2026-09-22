import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Ported from k2-ui-foundation-test. Used by every component in
 * src/components/ui/ so variant classes (from class-variance-authority)
 * and any caller-supplied `className` merge correctly instead of both
 * classes landing in the DOM and letting CSS source order decide the
 * winner.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
