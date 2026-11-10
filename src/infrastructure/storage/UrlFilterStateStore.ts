import type { FilterStateStore } from '../../application/ports';

export interface LocationLike {
  readonly href: string;
}
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Refleja el filtro en la query string: sin `cat` = todas; `cat=` = ninguna; `cat=a,b` = esas.
 * Usa `replaceState` para no llenar el historial.
 */
export class UrlFilterStateStore implements FilterStateStore {
  constructor(
    private readonly location: LocationLike,
    private readonly history: HistoryLike,
    private readonly param = 'cat',
  ) {}

  load(): string[] | null {
    const value = new URL(this.location.href).searchParams.get(this.param);
    if (value === null) return null;
    return value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }

  save(activeCategoryIds: string[] | null): void {
    const url = new URL(this.location.href);
    if (activeCategoryIds === null) url.searchParams.delete(this.param);
    else url.searchParams.set(this.param, activeCategoryIds.join(','));
    // Las comas son legibles y seguras en la query: se evitan los %2C.
    const query = url.searchParams.toString().replace(/%2C/gi, ',');
    this.history.replaceState(null, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  }
}

/** Lee flags booleanos de la URL (`?private=1`, `?debug=1`). */
export function readUrlFlag(href: string, name: string): boolean {
  const value = new URL(href).searchParams.get(name);
  return value !== null && value !== '0' && value !== 'false';
}
