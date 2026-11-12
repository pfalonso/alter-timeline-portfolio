import type {
  SelectionViewState,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';
import type { LifeEvent, Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { append, clear, el, NEUTRAL_CHIP, safeLink } from './dom';
import { STRINGS } from './strings';

/**
 * Pop-up de detalle: diálogo NO modal (role="dialog" sin aria-modal). Es un panel lateral sin
 * velo: la escena, los filtros y el índice siguen operables mientras está abierto, así que el
 * foco tampoco se atrapa (Tab sale del panel con normalidad). Al abrir lleva el foco al panel y
 * al cerrar lo devuelve, salvo que el usuario ya lo haya movido. Todo el contenido del JSON se
 * pinta con textContent.
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
  /** Cabecera del modo historia: progreso, capítulo y frase puente. */
  private readonly storySlot = el('div', { class: 'popup__story' });
  private readonly exitStoryButton = el('button', {
    class: 'popup__exit-story',
    attrs: { type: 'button' },
    text: STRINGS.storyExit,
  });
  private readonly storyNextButton = el('button', {
    class: 'popup__story-next',
    attrs: { type: 'button' },
    text: `${STRINGS.storyNext} →`,
  });

  constructor(
    private readonly root: HTMLElement,
    /** Elementos que NO cierran el pop-up al pulsar sobre ellos (escena, filtros, controles). */
    private readonly keepOpenSelector = '[data-keep-popup]',
  ) {
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-labelledby', 'popup-title');
    root.tabIndex = -1;
    root.hidden = true;
    this.storySlot.hidden = true;
    this.exitStoryButton.hidden = true;
    this.storyNextButton.hidden = true;
    root.append(
      el('div', { class: 'popup__bar' }, [this.exitStoryButton, this.closeButton]),
      this.storySlot,
      this.body,
      el('div', { class: 'popup__footer' }, [this.prevButton, this.storyNextButton, this.nextButton]),
    );
    this.closeButton.addEventListener('click', () => this.handlers?.onDetailClosed());
    this.exitStoryButton.addEventListener('click', () => this.handlers?.onStoryExit());
    this.storyNextButton.addEventListener('click', () => this.handlers?.onStoryStep('next'));
    this.prevButton.addEventListener('click', () => this.handlers?.onNavigate('previous'));
    this.nextButton.addEventListener('click', () => this.handlers?.onNavigate('next'));
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
    this.root.classList.toggle('popup--story', state.story !== undefined);
    this.fillStory(event, state);
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

  /** Cabecera del modo historia y enlace «Siguiente en la historia». Se refresca en cada estado. */
  private fillStory(event: LifeEvent, state: SelectionViewState): void {
    const timeline = this.timeline as Timeline;
    const story = state.story;
    this.exitStoryButton.hidden = !story;
    this.storyNextButton.hidden = story !== undefined || state.storyNextId === undefined;
    clear(this.storySlot);
    this.storySlot.hidden = !story;
    if (!story) return;
    const arc = story.arcId ? timeline.getArc(story.arcId) : undefined;
    this.storySlot.append(
      el('p', { class: 'popup__progress' }, [
        el('span', {
          class: 'popup__step',
          text: STRINGS.storyProgress(story.index, story.total),
          attrs: { 'aria-label': STRINGS.storyProgressLabel(story.index, story.total) },
        }),
        arc ? el('span', { class: 'popup__arc', text: arc.title }) : null,
      ]),
    );
    if (event.bridge) this.storySlot.append(el('p', { class: 'popup__bridge', text: event.bridge }));
  }

  private fill(event: LifeEvent): void {
    const timeline = this.timeline as Timeline;
    const categories = timeline.categoriesOf(event);
    // Un solo código de color: el de la línea vital del evento (las categorías van en neutro).
    const accent = timeline.lineColorOf(event.branch) ?? '#9fd8ff';
    this.root.style.setProperty('--accent', accent);
    clear(this.body);

    const tags = el('ul', { class: 'popup__categories' });
    for (const category of categories) {
      const tag = el('li', { class: 'tag', text: `${category.icon ? `${category.icon} ` : ''}${category.label}` });
      tag.style.setProperty('--chip-color', NEUTRAL_CHIP);
      tags.append(tag);
    }

    const facts = el('dl', { class: 'popup__facts' });
    const addFact = (term: string, value: string | undefined): void => {
      if (value) facts.append(el('div', {}, [el('dt', { text: term }), el('dd', { text: value })]));
    };
    addFact(STRINGS.when, event.formatDateRange(timeline.meta.locale, STRINGS.present));
    addFact(STRINGS.where, event.location);
    addFact(STRINGS.with, event.organization);

    const origin = event.branchFrom ? timeline.getEvent(event.branchFrom) : undefined;
    const line = timeline.getLine(event.branch);
    const arc = timeline.arcOf(event);

    append(
      this.body,
      tags,
      el('h2', { class: 'popup__title', text: event.title, attrs: { id: 'popup-title' } }),
      event.subtitle ? el('p', { class: 'popup__subtitle', text: event.subtitle }) : null,
      el('div', { class: 'popup__badges' }, [
        arc ? el('span', { class: 'badge badge--arc', text: STRINGS.arcOf(arc.title) }) : null,
        event.active ? el('span', { class: 'badge badge--live badge--active', text: STRINGS.active }) : null,
        event.ongoing && !event.active ? el('span', { class: 'badge badge--live', text: STRINGS.ongoing }) : null,
        event.isPrivate ? el('span', { class: 'badge', text: STRINGS.privateEvent }) : null,
        event.isUnion ? this.linesBadges(event) : line ? this.lineBadge(STRINGS.lineOf(line.label), accent) : null,
        origin && !line ? el('span', { class: 'badge badge--branch', text: STRINGS.branchFrom(origin.title) }) : null,
      ]),
      facts,
      el('p', { class: 'popup__summary', text: event.summary }),
      ...event.paragraphs.map((paragraph) => el('p', { class: 'popup__paragraph', text: paragraph })),
      this.causalSection(STRINGS.cameFrom, timeline.causesOf(event.id), 'popup__causes'),
      this.causalSection(STRINGS.ledTo, timeline.consequencesOf(event.id), 'popup__consequences'),
      this.mediaSection(event),
      this.listSection(STRINGS.highlights, event.highlights, 'popup__highlights'),
      this.listSection(STRINGS.skills, event.skills, 'popup__skills'),
      this.linksSection(event),
    );
  }

  /** Nodo de unión: «Líneas:» y un chip por cada línea que pasa por él (la dueña primero). */
  private linesBadges(event: LifeEvent): HTMLElement {
    const timeline = this.timeline as Timeline;
    return el('span', { class: 'popup__lines' }, [
      el('span', { class: 'popup__lines-label', text: STRINGS.linesOf }),
      ...event.lineIds.map((id) => this.lineBadge(timeline.getLine(id)?.label ?? id, timeline.lineColorOf(id) ?? '#9fd8ff')),
    ]);
  }

  private lineBadge(text: string, color: string): HTMLElement {
    const badge = el('span', { class: 'badge badge--branch badge--line', text });
    badge.style.setProperty('--chip-color', color);
    return badge;
  }

  private listSection(title: string, items: readonly string[], className: string): HTMLElement | null {
    if (items.length === 0) return null;
    return el('section', { class: 'popup__section' }, [
      el('h3', { text: title }),
      el('ul', { class: className }, items.map((item) => el('li', { text: item }))),
    ]);
  }

  /** «Esto llevó a…» / «Viene de…»: botones que abren el evento enlazado (con su fecha y color). */
  private causalSection(title: string, events: readonly LifeEvent[], className: string): HTMLElement | null {
    if (events.length === 0) return null;
    const timeline = this.timeline as Timeline;
    const items = events.map((target) => {
      const button = el(
        'button',
        { class: 'popup__causal', attrs: { type: 'button', 'data-event': target.id, 'aria-label': STRINGS.goTo(target.title) } },
        [
          el('span', { class: 'popup__causal-title', text: target.title }),
          el('span', { class: 'popup__causal-date', text: target.formatDateRange(timeline.meta.locale, STRINGS.present) }),
        ],
      );
      button.style.setProperty('--chip-color', timeline.lineColorOf(target.branch) ?? '#9fd8ff');
      button.addEventListener('click', () => this.handlers?.onEventActivated(target.id));
      return el('li', {}, [button]);
    });
    return el('section', { class: `popup__section ${className}` }, [el('h3', { text: title }), el('ul', { class: 'popup__causal-list' }, items)]);
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

  private onOutsidePointer(event: Event): void {
    if (this.openEventId === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.root.contains(target) || target.closest(this.keepOpenSelector)) return;
    this.handlers?.onDetailClosed();
  }
}
