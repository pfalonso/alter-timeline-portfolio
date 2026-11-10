import type { LoadedLifeData, TimelineRepository } from '../../application/ports';
import type { ValidationIssue } from '../../domain/errors';
import { formatIssue } from '../../domain/errors';
import type { LifeData } from '../../domain/model';
import type { LifeDataValidator } from '../../domain/services';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TimelineUrls {
  /** JSON personal (puede no existir). `null` = ir directamente al de ejemplo. */
  readonly primary: string | null;
  /** JSON de ejemplo, siempre presente en el build. */
  readonly fallback: string;
}

export const DEFAULT_URLS: TimelineUrls = {
  primary: '/data/life.json',
  fallback: '/data/life.example.json',
};

export class DataLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataLoadError';
  }
}

type Attempt =
  | { readonly ok: true; readonly data: LifeData }
  | { readonly ok: false; readonly reason: string; readonly issues?: readonly ValidationIssue[] };

/** Carga `life.json`; si falta o no valida, cae a `life.example.json`. */
export class HttpJsonTimelineRepository implements TimelineRepository {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly validator: LifeDataValidator,
    private readonly urls: TimelineUrls = DEFAULT_URLS,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  async load(): Promise<LoadedLifeData> {
    const primary: Attempt =
      this.urls.primary === null ? { ok: false, reason: 'omitido' } : await this.attempt(this.urls.primary);
    if (primary.ok) return { data: primary.data, source: 'personal' };
    if (primary.issues) {
      this.warn(
        `[timeline] ${this.urls.primary} no es válido; se usan los datos de ejemplo.\n` +
          primary.issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n'),
      );
    }

    const fallback = await this.attempt(this.urls.fallback);
    if (fallback.ok) return { data: fallback.data, source: 'example', rejectedIssues: primary.issues };
    throw new DataLoadError(`No se han podido cargar los datos (${this.urls.fallback}: ${fallback.reason}).`);
  }

  private async attempt(url: string): Promise<Attempt> {
    let payload: unknown;
    try {
      const response = await this.fetchFn(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      payload = await response.json();
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'error de red' };
    }
    const result = this.validator.validate(payload);
    return result.ok && result.data
      ? { ok: true, data: result.data }
      : { ok: false, reason: `${result.issues.length} errores de validación`, issues: result.issues };
  }
}
