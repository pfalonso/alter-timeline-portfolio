export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidDateError extends DomainError {
  constructor(readonly raw: string) {
    super(`Fecha no válida: "${raw}" (se espera YYYY, YYYY-MM o YYYY-MM-DD)`);
  }
}
