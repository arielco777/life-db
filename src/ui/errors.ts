import { isDomainError } from '@/domain/errors';

/** A user-facing message for a failed operation. Domain errors are already written for people. */
export function errorMessage(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error && e.message) return `Something went wrong: ${e.message}`;
  return 'Something went wrong.';
}
