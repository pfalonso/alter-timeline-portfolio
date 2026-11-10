import { DomainError } from './DomainError';

export interface ValidationIssue {
  /** Ruta dentro del documento, p. ej. `events[3].date.start`. */
  readonly path: string;
  readonly message: string;
}

export function formatIssue(issue: ValidationIssue): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
}

export class ValidationError extends DomainError {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(
      `Datos no válidos (${issues.length} ${issues.length === 1 ? 'error' : 'errores'}):\n` +
        issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n'),
    );
  }
}
