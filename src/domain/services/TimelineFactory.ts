import type { Category } from '../model/Category';
import type { LifeArc } from '../model/LifeArc';
import type { ArcData, BranchInfoData, LifeData, LifeEventData } from '../model/LifeData';
import { DEFAULT_IMPORTANCE, LifeEvent, MAIN_BRANCH } from '../model/LifeEvent';
import { DEFAULT_FOCUS_LEVEL, type LifeLine } from '../model/LifeLine';
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
      .map((event) => this.toEvent(event, data.meta.mainBranch ?? MAIN_BRANCH));
    const starts = new Map(data.events.map((event) => [event.id, PartialDate.parse(event.date.start)]));
    const lines = (data.branches ?? []).map((line) => this.toLine(line, starts));
    const arcs = (data.arcs ?? []).map((arc) => this.toArc(arc));
    const story = data.story ? { title: data.story.title, path: [...data.story.path] } : undefined;
    return new Timeline({ ...data.meta }, categories, events, PartialDate.fromDate(options.now), lines, { arcs, story });
  }

  private toArc(raw: ArcData): LifeArc {
    return {
      id: raw.id,
      title: raw.title,
      subtitle: raw.subtitle,
      start: PartialDate.parse(raw.start),
      end: raw.end === PRESENT ? null : PartialDate.parse(raw.end),
      summary: raw.summary,
    };
  }

  private toLine(raw: BranchInfoData, starts: ReadonlyMap<string, PartialDate>): LifeLine {
    return {
      id: raw.id,
      label: raw.label,
      color: raw.color,
      description: raw.description,
      originEventId: raw.origin,
      mergeInto: raw.mergeInto ? { branch: raw.mergeInto.branch, eventId: raw.mergeInto.event } : undefined,
      untilPresent: raw.until === PRESENT,
      style: raw.style,
      ghost: raw.ghost === true,
      // Las fechas se toman de todos los eventos (también privados): la pausa no depende de lo visible.
      pauses: (raw.pauses ?? []).flatMap((pause) => {
        const from = starts.get(pause.from);
        const to = starts.get(pause.to);
        return from && to ? [{ fromEventId: pause.from, toEventId: pause.to, from, to }] : [];
      }),
      focus: (raw.focus ?? []).map((period) => ({
        start: PartialDate.parse(period.start),
        end: period.end === undefined || period.end === PRESENT ? null : PartialDate.parse(period.end),
        level: period.level ?? DEFAULT_FOCUS_LEVEL,
      })),
    };
  }

  private toEvent(raw: LifeEventData, mainBranch: string): LifeEvent {
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
      branch: raw.branch ?? mainBranch,
      branchFrom: raw.branchFrom,
      isPrivate: raw.visibility === 'private',
      bridge: raw.bridge?.trim() || undefined,
      ledTo: [...new Set(raw.ledTo ?? [])],
      alsoBranches: [...new Set(raw.alsoBranches ?? [])].filter((id) => id !== (raw.branch ?? mainBranch)),
      active: raw.active === true,
    });
  }
}
