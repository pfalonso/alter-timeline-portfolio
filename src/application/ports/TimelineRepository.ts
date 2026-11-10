import type { ValidationIssue } from '../../domain/errors';
import type { LifeData } from '../../domain/model';

/** De dónde salieron los datos: el JSON personal o el de ejemplo (fallback). */
export type DataSource = 'personal' | 'example';

export interface LoadedLifeData {
  readonly data: LifeData;
  readonly source: DataSource;
  /** Si se cayó al ejemplo porque el JSON personal no validaba, sus errores. */
  readonly rejectedIssues?: readonly ValidationIssue[];
}

/** Puerto de salida: obtiene un `LifeData` ya validado. */
export interface TimelineRepository {
  load(): Promise<LoadedLifeData>;
}
