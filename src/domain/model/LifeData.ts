/**
 * Forma "en crudo" del JSON de datos (contrato `LifeData`, schemaVersion 1).
 * Este fichero solo declara tipos.
 */
export interface LinkData {
  label: string;
  url: string;
}

export interface MediaData {
  type: 'image';
  url: string;
  alt: string;
}

export interface CategoryData {
  id: string;
  label: string;
  color: string;
  icon?: string;
  description?: string;
}

export interface LifeEventData {
  id: string;
  title: string;
  subtitle?: string;
  date: { start: string; end?: string };
  categories: string[];
  summary: string;
  description?: string;
  location?: string;
  organization?: string;
  skills?: string[];
  highlights?: string[];
  links?: LinkData[];
  media?: MediaData[];
  importance?: 1 | 2 | 3;
  branch?: string;
  branchFrom?: string;
  visibility?: 'public' | 'private';
}

export interface LifeMetaData {
  owner: string;
  title: string;
  tagline?: string;
  locale: string;
  contact?: LinkData[];
}

export interface LifeData {
  schemaVersion: 1;
  meta: LifeMetaData;
  categories: CategoryData[];
  events: LifeEventData[];
}
