import type { TimelineViewModel } from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';
import { contactActions } from './contactActions';
import { append, clear, el } from './dom';
import { STRINGS } from './strings';

/**
 * Antetítulo sin repetir el nombre: si `meta.title` empieza por el nombre («Ada Test · línea a
 * línea») queda lo que sigue al separador; si es solo el nombre, nada.
 */
export function eyebrowOf(owner: string, title: string): string | null {
  const clean = title.trim();
  if (clean.toLowerCase() === owner.trim().toLowerCase()) return null;
  if (clean.toLowerCase().startsWith(owner.trim().toLowerCase())) {
    const rest = clean.slice(owner.trim().length).replace(/^[\s·:—–|-]+/, '').trim();
    return rest.length > 0 ? rest : null;
  }
  return clean;
}

/**
 * Cabecera: nombre, oficio (`headline`), ubicación y disponibilidad, frase (secundaria, 2 líneas
 * como mucho) y acciones de contacto (reel, CV, correo, GitHub…). El botón principal de la historia
 * va justo debajo, fuera de este bloque (lo gestiona `StoryControls`).
 */
export class Hud implements TimelineViewPart {
  constructor(private readonly root: HTMLElement) {}

  render(model: TimelineViewModel): void {
    const { meta } = model.timeline;
    clear(this.root);
    document.title = meta.headline ? `${meta.owner} — ${meta.headline}` : `${meta.owner} — ${meta.title}`;
    document.documentElement.lang = meta.locale;

    const eyebrow = eyebrowOf(meta.owner, meta.title);
    const where = [meta.location, meta.availability].filter((part): part is string => Boolean(part?.trim()));
    const actions = contactActions(meta, 'action');

    append(
      this.root,
      eyebrow ? el('p', { class: 'hud__eyebrow', text: eyebrow }) : null,
      el('h1', { class: 'hud__owner', text: meta.owner }),
      meta.headline ? el('p', { class: 'hud__headline', text: meta.headline }) : null,
      where.length > 0
        ? el('p', { class: 'hud__where' }, where.map((part, i) => el('span', { class: i === 0 && meta.location ? 'hud__location' : 'hud__availability', text: part })))
        : null,
      meta.tagline ? el('p', { class: 'hud__tagline', text: meta.tagline }) : null,
      actions.length > 0 ? el('ul', { class: 'hud__contact actions' }, actions.map((action) => el('li', {}, [action]))) : null,
      model.source === 'example'
        ? el('p', {
            class: 'hud__notice',
            text: STRINGS.exampleData,
            attrs: { title: STRINGS.exampleDataHint, role: 'status', 'data-testid': 'example-notice' },
          })
        : null,
    );
  }

  showLoadError(message: string): void {
    clear(this.root);
    this.root.append(
      el('h1', { class: 'hud__owner', text: STRINGS.loadError }),
      el('p', { class: 'hud__tagline', text: message, attrs: { role: 'alert' } }),
    );
  }
}
