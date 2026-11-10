import type { Category } from '../model/Category';
import type { LifeData, LifeEventData } from '../model/LifeData';
import { DEFAULT_IMPORTANCE, LifeEvent, MAIN_BRANCH } from '../model/LifeEvent';
import { PartialDate } from '../model/PartialDate';
import { Timeline } from '../model/Timeline';
import { PRESENT } from './LifeDataValidator';
import { isHttpUrl } from './safeUrl';

export interface TimelineFactoryOptions {
  /** Incluye los eventos `visibility: "private"`. */
  readonly includePrivate?: boolean;
  /** Fecha actual (inyectada para que el resultado sea determinista). */
  readonly now: Date;
}

/** Convierte un `LifeData` YA VALIDADO en el agregado `Timeline`. */
export class TimelineFactory {
  create(data: LifeData, options: TimelineFactoryOptions): Timeline {
    const categories: Category[] = data.categories.map((category) => ({ ...category }));
    const events = data.events
      .filter((event) => options.includePrivate === true || event.visibility !== 'private')
      .map((event) => this.toEvent(event));
    return new Timeline({ ...data.meta }, categories, events, PartialDate.fromDate(options.now));
  }

  private toEvent(raw: LifeEventData): LifeEvent {
    const ongoing = raw.date.end === PRESENT;
    return new LifeEvent({
      id: raw.id,
      title: raw.title,
      shortTitle: raw.shortTitle?.trim() || undefined,
      subtitle: raw.subtitle,
      start: PartialDate.parse(raw.date.start),
      end: raw.date.end !== undefined && !ongoing ? PartialDate.parse(raw.date.end) : null,
      ongoing,
      categoryIds: [...new Set(raw.categories)],
      summary: raw.summary,
      description: raw.description,
      location: raw.location,
      organization: raw.organization,
      skills: [...(raw.skills ?? [])],
      highlights: [...(raw.highlights ?? [])],
      // Defensa en profundidad: aunque el validador ya lo exige, aquí nunca pasan URLs no http(s).
      links: (raw.links ?? []).filter((link) => isHttpUrl(link.url)),
      media: (raw.media ?? []).filter((item) => isHttpUrl(item.url)),
      importance: raw.importance ?? DEFAULT_IMPORTANCE,
      branch: raw.branch ?? MAIN_BRANCH,
      branchFrom: raw.branchFrom,
      isPrivate: raw.visibility === 'private',
    });
  }
}
