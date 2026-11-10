import { describe, expect, it } from 'vitest';
import { DomainError, InvalidDateError, ValidationError, formatIssue } from '../../../src/domain/errors';

describe('errores de dominio', () => {
  it('DomainError usa el nombre de la subclase', () => {
    expect(new DomainError('x').name).toBe('DomainError');
    const error = new InvalidDateError('2019-99');
    expect(error.name).toBe('InvalidDateError');
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.raw).toBe('2019-99');
  });

  it('formatIssue antepone la ruta salvo que esté vacía', () => {
    expect(formatIssue({ path: 'events[3].date.start', message: 'mal' })).toBe('events[3].date.start: mal');
    expect(formatIssue({ path: '', message: 'el documento debe ser un objeto JSON' })).toBe(
      'el documento debe ser un objeto JSON',
    );
  });

  it('ValidationError lista todos los errores y concuerda el número', () => {
    const one = new ValidationError([{ path: 'meta.owner', message: 'falta' }]);
    expect(one.message).toBe('Datos no válidos (1 error):\n  - meta.owner: falta');
    const two = new ValidationError([
      { path: 'meta.owner', message: 'falta' },
      { path: 'events', message: 'debe ser una lista de eventos' },
    ]);
    expect(two.message).toContain('(2 errores)');
    expect(two.message).toContain('  - events: debe ser una lista de eventos');
    expect(two.issues).toHaveLength(2);
    expect(two.name).toBe('ValidationError');
  });
});
