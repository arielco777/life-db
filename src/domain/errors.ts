export type DomainErrorCode = 'validation' | 'not_found' | 'conflict' | 'type_locked';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const isDomainError = (e: unknown, code?: DomainErrorCode): e is DomainError =>
  e instanceof DomainError && (code === undefined || e.code === code);
