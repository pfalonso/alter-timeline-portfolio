import type {
  SelectionViewState,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';
import type { LifeEvent, Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { append, clear, el, focusableWithin, safeLink } from './dom';
import { STRINGS } from './strings';

/**
 * Pop-up de detalle (role="dialog", aria-modal). Gestiona el foco: lo atrapa mientras está
 * abierto y lo devuelve al cerrar. Todo el contenido del JSON se pinta con textContent.
 */
export class EventPopup implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private openEventId: string | null = null;
  private returnFocus: HTMLElement | null = null;

  private readonly body = el('div', { class: 'popup__body' });
  private readonly closeButton = el('button', {
    class: 'popup__close',
    attrs: { type: 'button', 'aria-label': STRINGS.close },
    text: '✕',
  });
  private readonly prevButton = el('button', { class: 'popup__nav', attrs: { type: 'button' }, text: `← ${STRINGS.previous}` });
  private readonly nextButton = el('button', { class: 'popup__nav', attrs: { type: 'button' }, text: `${STRINGS.next} →` });

  constructor(
    private readonly root: HTMLElement,
    /** Elementos que NO cierran el pop-up al pulsar sobre ellos (escena, filtros, controles). */
    private readonly keepOpenSelector = '[data-keep-popup]',
  ) {
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'popup-title');
    root.tabIndex = -1;
    root.hidden = true;
    root.append(
      el('div', { class: 'popup__bar' }, [this.closeButton]),
      this.body,
      el('div', { class: 'popup__footer' }, [this.prevButton, this.nextButton]),
    );
    this.closeButton.addEventListener('click', () => this.handlers?.onDetailClosed());
    this.prevButton.addEventListener('click', () => this.handlers?.onNavigate('previous'));
    this.nextButton.addEventListener('click', () => this.handlers?.onNavigate('next'));
    root.addEventListener('keydown', (event) => this.trapFocus(event));
    document.addEventListener('pointerdown', (event) => this.onOutsidePointer(event));
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
  }

  applySelection(state: SelectionViewState): void {
    const event =
      state.detailOpen && state.focusedEventId !== null ? this.timeline?.getEvent(state.focusedEventId) : undefined;
    if (!event) {
      this.close();
      return;
    }
    this.prevButton.disabled = !state.hasPrevious;
    this.nextButton.disabled = !state.hasNext;
    if (this.openEventId === event.id) return;

    const wasOpen = this.openEventId !== null;
    if (!wasOpen) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openEventId = event.id;
    this.fill(event);
    this.root.hidden = false;
    this.root.classList.remove('popup--enter');
    void this.root.offsetWidth; // reinicia la animación de entrada
    this.root.classList.add('popup--enter');
    this.body.scrollTop = 0;
    // Al navegar con los botones del propio pop-up se conserva el foco donde estaba.
    if (!wasOpen || !this.root.contains(document.activeElement)) this.root.focus({ preventScroll: true });
  }

  get isOpen(): boolean {
    return this.openEventId !== null;
  }

  private close(): void {
    if (this.openEventId === null) return;
    this.openEventId = null;
    // Solo se devuelve el foco si sigue en el pop-up (o se ha perdido): si el usuario ya lo ha
    // llevado a otro control (p. ej. un chip de filtro), no se le quita.
    const active = document.activeElement;
    const focusIsElsewhere = active !== null && active !== document.body && !this.root.contains(active);
    this.root.hidden = true;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && target.isConnected && !focusIsElsewhere) target.focus({ preventScroll: true });
  }

  private fill(event: LifeEvent): void {
    const timeline = this.timeline as Timeline;
    const categories = timeline.categoriesOf(event);
    const accent = categories[0]?.color ?? '#9fd8ff';
    this.root.style.setProperty('--accent', accent);
    clear(this.body);

    const tags = el('ul', { class: 'popup__categories' });
    for (const category of categories) {
      const tag = el('li', { class: 'tag', text: `${category.icon ? `${category.icon} ` : ''}${category.label}` });
      tag.style.setProperty('--chip-color', category.color);
      tags.append(tag);
    }

    const facts = el('dl', { class: 'popup__facts' });
    const addFact = (term: string, value: string | undefined): void => {
      if (value) facts.append(el('div', {}, [el('dt', { text: term }), el('dd', { text: value })]));
    };
    addFact('Cuándo', event.formatDateRange(timeline.meta.locale, STRINGS.present));
    addFact('Dónde', event.location);
    addFact('Con', event.organization);

    const origin = event.branchFrom ? timeline.getEvent(event.branchFrom) : undefined;

    append(
      this.body,
      tags,
      el('h2', { class: 'popup__title', text: event.title, attrs: { id: 'popup-title' } }),
      event.subtitle ? el('p', { class: 'popup__subtitle', text: event.subtitle }) : null,
      el('div', { class: 'popup__badges' }, [
        event.ongoing ? el('span', { class: 'badge badge--live', text: STRINGS.ongoing }) : null,
        event.isPrivate ? el('span', { class: 'badge', text: STRINGS.privateEvent }) : null,
        origin ? el('span', { class: 'badge badge--branch', text: STRINGS.branchFrom(origin.title) }) : null,
      ]),
      facts,
      el('p', { class: 'popup__summary', text: event.summary }),
      ...event.paragraphs.map((paragraph) => el('p', { class: 'popup__paragraph', text: paragraph })),
      this.mediaSection(event),
      this.listSection(STRINGS.highlights, event.highlights, 'popup__highlights'),
      this.listSection(STRINGS.skills, event.skills, 'popup__skills'),
      this.linksSection(event),
    );
  }

  private listSection(title: string, items: readonly string[], className: string): HTMLElement | null {
    if (items.length === 0) return null;
    return el('section', { class: 'popup__section' }, [
      el('h3', { text: title }),
      el('ul', { class: className }, items.map((item) => el('li', { text: item }))),
    ]);
  }

  private linksSection(event: LifeEvent): HTMLElement | null {
    const links = event.links
      .map((link) => safeLink(`${link.label} ↗`, link.url, 'popup__link'))
      .filter((link): link is HTMLAnchorElement => link !== null);
    if (links.length === 0) return null;
    return el('section', { class: 'popup__section' }, [
      el('h3', { text: STRINGS.links }),
      el('ul', { class: 'popup__links' }, links.map((link) => el('li', {}, [link]))),
    ]);
  }

  private mediaSection(event: LifeEvent): HTMLElement | null {
    if (event.media.length === 0) return null;
    const figures = event.media.map((item) => {
      const image = el('img', { attrs: { alt: item.alt, loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' } });
      image.src = item.url;
      image.addEventListener('error', () => image.closest('figure')?.remove());
      return el('figure', { class: 'popup__figure' }, [image, item.alt ? el('figcaption', { text: item.alt }) : null]);
    });
    return el('div', { class: 'popup__media' }, figures);
  }

  private trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || this.openEventId === null) return;
    const focusable = focusableWithin(this.root);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private onOutsidePointer(event: Event): void {
    if (this.openEventId === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.root.contains(target) || target.closest(this.keepOpenSelector)) return;
    this.handlers?.onDetailClosed();
  }
}
