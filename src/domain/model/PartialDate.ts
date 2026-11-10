import { InvalidDateError } from '../errors/DomainError';

export type DatePrecision = 'year' | 'month' | 'day';

const PATTERN = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * Fecha de precisión variable ("2019", "2019-03" o "2019-03-14"). Value object inmutable.
 */
export class PartialDate {
  private constructor(
    readonly year: number,
    readonly month: number | null,
    readonly day: number | null,
  ) {}

  static parse(raw: string): PartialDate {
    const date = PartialDate.tryParse(raw);
    if (!date) throw new InvalidDateError(String(raw));
    return date;
  }

  static tryParse(raw: unknown): PartialDate | null {
    if (typeof raw !== 'string') return null;
    const match = PATTERN.exec(raw);
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[2] === undefined ? null : Number(match[2]);
    const day = match[3] === undefined ? null : Number(match[3]);
    if (year < 1000) return null;
    if (month !== null && (month < 1 || month > 12)) return null;
    if (day !== null && (month === null || day < 1 || day > daysInMonth(year, month))) return null;
    return new PartialDate(year, month, day);
  }

  static fromDate(date: Date): PartialDate {
    return new PartialDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  get precision(): DatePrecision {
    if (this.day !== null) return 'day';
    return this.month !== null ? 'month' : 'year';
  }

  /** Año decimal del INICIO del periodo representado (2019-07 → 2019.5). */
  toDecimalYear(): number {
    const month = this.month ?? 1;
    const day = this.day ?? 1;
    let dayOfYear = day - 1;
    for (let m = 1; m < month; m += 1) dayOfYear += daysInMonth(this.year, m);
    return this.year + dayOfYear / daysInYear(this.year);
  }

  /** Año decimal del FINAL del periodo representado (2019 → 2020.0, 2019-03 → 1 de abril). */
  toDecimalYearEnd(): number {
    if (this.month === null) return this.year + 1;
    if (this.day === null) {
      return this.month === 12 ? this.year + 1 : new PartialDate(this.year, this.month + 1, null).toDecimalYear();
    }
    return this.toDecimalYear() + 1 / daysInYear(this.year);
  }

  /** <0 si esta fecha empieza antes que `other`, 0 si empiezan a la vez, >0 si después. */
  compareTo(other: PartialDate): number {
    return (
      this.year - other.year || (this.month ?? 1) - (other.month ?? 1) || (this.day ?? 1) - (other.day ?? 1)
    );
  }

  /**
   * `true` si con seguridad esta fecha es anterior a `other` teniendo en cuenta la precisión
   * (2019 no es anterior a 2019-03: lo contiene).
   */
  isDefinitelyBefore(other: PartialDate): boolean {
    return this.toDecimalYearEnd() <= other.toDecimalYear() + 1e-9;
  }

  equals(other: PartialDate): boolean {
    return this.year === other.year && this.month === other.month && this.day === other.day;
  }

  format(locale = 'es'): string {
    if (this.month === null) return String(this.year);
    const date = new Date(Date.UTC(this.year, this.month - 1, this.day ?? 1));
    const options: Intl.DateTimeFormatOptions =
      this.day === null
        ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
    try {
      return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
      return this.toString();
    }
  }

  toString(): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    if (this.month === null) return String(this.year);
    return this.day === null
      ? `${this.year}-${pad(this.month)}`
      : `${this.year}-${pad(this.month)}-${pad(this.day)}`;
  }
}
