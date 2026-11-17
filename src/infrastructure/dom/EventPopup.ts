import type { SelectionViewState, StoryViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import type { LifeEvent, Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { append, clear, el, safeLink } from './dom';
import { icon } from './icons';
import { STRINGS } from './strings';

/** Enlaces que suben junto al título como botones (lo que busca quien contrata: reel, código…). */
const PRIMARY_LINKS = 2;
/** Arrastrar el asa de la hoja (móvil) más de esto hacia abajo la cierra. */
const SWIPE_CLOSE_PX = 70;

/**
 * Ficha de un momento: diálogo NO modal (role="dialog" sin aria-modal). En escritorio es un panel
 * lateral; en móvil, una hoja inferior (≤ 55 % del alto, ampliable) que deja ver la escena. Orden
 * (sin repetir datos): contexto (fecha · lugar · entidad), título, subtítulo, enlaces, entradilla,
 * habilidades, cuerpo… y al pie, en pequeño, líneas y categorías. En la historia lleva arriba el
 * progreso (barra por capítulos) y la frase puente, que es lo primero que se lee. Al abrir lleva el
 * foco al panel y al cerrar lo devuelve, salvo que el usuario ya lo haya movido. Todo el contenido
 * del JSON se pinta con textContent.
 */
export class EventPopup implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private openEventId: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private inStory = false;
  private dragged = false;
  private handlePressed = false;

  private readonly body = el('div', { class: 'popup__body' });
  private readonly handle = el('button', {
    class: 'popup__handle',
    attrs: { type: 'button', 'aria-label': STRINGS.sheetHandle, 'aria-expanded': 'false' },
  });
  private readonly closeButton = el('button', {
    class: 'popup__close',
    attrs: { type: 'button', 'aria-label': STRINGS.close, title: STRINGS.close },
  }, [icon('close')]);
  private readonly prevButton = el('button', { class: 'popup__nav popup__nav--prev', attrs: { type: 'button' } });
  private readonly nextButton = el('button', { class: 'popup__nav popup__nav--next', attrs: { type: 'button' } });
  /** Cabecera del modo historia: progreso por capítulos y frase puente. */
  private readonly storySlot = el('div', { class: 'popup__story' });
  private readonly progressText = el('p', { class: 'popup__progress' });
  private readonly exitStoryButton = el('button', { class: 'popup__exit-story', attrs: { type: 'button' } }, [
    el('span', { text: STRINGS.storyExit }),
    icon('close'),
  ]);
  private readonly storyNextButton = el('button', { class: 'popup__story-next', attrs: { type: 'button' } }, [
    el('span', { text: STRINGS.storyNext }),
    icon('arrow'),
  ]);
  private readonly more = el('span', { class: 'popup__more', text: `↓ ${STRINGS.scrollMore}`, attrs: { 'aria-hidden': 'true' } });

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
      this.handle,
      el('div', { class: 'popup__bar' }, [this.progressText, this.exitStoryButton, this.closeButton]),
      this.storySlot,
      this.body,
      this.more,
      el('div', { class: 'popup__footer' }, [this.prevButton, this.storyNextButton, this.nextButton]),
    );
    this.setNav(this.prevButton, STRINGS.previous, 'prev', false);
    this.setNav(this.nextButton, STRINGS.next, 'next', false);
    this.closeButton.addEventListener('click', () => this.handlers?.onDetailClosed());
    this.exitStoryButton.addEventListener('click', () => this.handlers?.onStoryExit());
    this.storyNextButton.addEventListener('click', () => this.handlers?.onStoryStep('next'));
    this.prevButton.addEventListener('click', () => this.handlers?.onNavigate('previous'));
    this.nextButton.addEventListener('click', () => this.handlers?.onNavigate('next'));
    this.body.addEventListener('scroll', () => this.updateMore(), { passive: true });
    this.handle.addEventListener('click', (event) => {
      // Un arrastre ya ha decidido; el clic que lo sigue no vuelve a cambiar el tamaño. Tampoco
      // cuenta el clic sintético de un toque que empezó fuera del asa (p. ej. el que abrió la ficha
      // y cae sobre el asa mientras la hoja entra); con teclado (detail 0) siempre vale.
      const pressedHere = this.handlePressed;
      this.handlePressed = false;
      if (this.dragged) this.dragged = false;
      else if (pressedHere || event.detail === 0) this.setExpanded(!root.classList.contains('popup--expanded'));
    });
    this.bindSwipe();
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
    const story = state.story;
    this.inStory = story !== undefined;
    this.root.classList.toggle('popup--story', this.inStory);
    this.fillNav(state);
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
    this.updateMore();
    // Al navegar con los botones del propio pop-up se conserva el foco donde estaba.
    if (!wasOpen || !this.root.contains(document.activeElement)) this.root.focus({ preventScroll: true });
  }

  get isOpen(): boolean {
    return this.openEventId !== null;
  }

  private close(): void {
    if (this.openEventId === null) return;
    this.openEventId = null;
    this.setExpanded(false);
    // Solo se devuelve el foco si sigue en el pop-up (o se ha perdido): si el usuario ya lo ha
    // llevado a otro control (p. ej. un chip de filtro), no se le quita.
    const active = document.activeElement;
    const focusIsElsewhere = active !== null && active !== document.body && !this.root.contains(active);
    this.root.hidden = true;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && target.isConnected && !focusIsElsewhere) target.focus({ preventScroll: true });
  }

  /** Anterior / Siguiente con el nombre del vecino; en la historia, el último paso dice «Terminar». */
  private fillNav(state: SelectionViewState): void {
    const timeline = this.timeline as Timeline;
    const story = state.story;
    const name = (id: string | undefined): string | null => {
      const event = id === undefined ? undefined : timeline.getEvent(id);
      return event ? event.labelTitle : null;
    };
    const last = story !== undefined && story.index === story.total - 1;
    const previous = story ? null : name(state.previousId);
    const next = story ? null : name(state.nextId);
    this.setNav(this.prevButton, previous ?? STRINGS.previous, 'prev', previous !== null);
    this.setNav(this.nextButton, next ?? (last ? STRINGS.finish : STRINGS.next), 'next', next !== null);
    this.prevButton.disabled = !state.hasPrevious;
    this.nextButton.disabled = !state.hasNext;
    // Un botón que no lleva a ningún sitio no se enseña apagado: se oculta.
    this.prevButton.hidden = !state.hasPrevious;
    this.nextButton.hidden = !state.hasNext;
    this.nextButton.classList.toggle('popup__nav--finish', last);
    this.nextButton.classList.toggle('popup__nav--primary', story !== undefined);
  }

  private setNav(button: HTMLButtonElement, text: string, side: 'prev' | 'next', named: boolean): void {
    clear(button);
    const label = el('span', { class: 'popup__nav-label', text });
    if (side === 'prev') button.append(el('span', { class: 'popup__nav-arrow', text: '←', attrs: { 'aria-hidden': 'true' } }), label);
    else button.append(label, el('span', { class: 'popup__nav-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }));
    button.title = named ? `${side === 'prev' ? STRINGS.previous : STRINGS.next}: ${text}` : '';
  }

  /** Cabecera del modo historia (progreso y puente) y enlace «Seguir la historia». Se refresca en cada estado. */
  private fillStory(event: LifeEvent, state: SelectionViewState): void {
    const timeline = this.timeline as Timeline;
    const story = state.story;
    this.exitStoryButton.hidden = !story;
    this.closeButton.hidden = story !== undefined;
    this.storyNextButton.hidden = story !== undefined || state.storyNextId === undefined;
    clear(this.storySlot);
    clear(this.progressText);
    this.storySlot.hidden = !story;
    this.progressText.hidden = !story;
    if (!story) return;
    const arc = story.arcId ? timeline.getArc(story.arcId) : undefined;
    const arcIndex = arc ? timeline.arcs.indexOf(arc) : -1;
    append(
      this.progressText,
      el('span', {
        class: 'popup__step',
        text: STRINGS.storyProgress(story.index, story.total),
        attrs: { 'aria-label': STRINGS.storyProgressLabel(story.index, story.total) },
      }),
      arc && story.mode !== 'short'
        ? el('span', { class: 'popup__arc', text: `${STRINGS.chapterOf(arcIndex, timeline.arcs.length)} · ${arc.title}` })
        : arc
          ? el('span', { class: 'popup__arc', text: arc.title })
          : null,
    );
    this.storySlot.append(this.progressBar(story));
    if (event.bridge) this.storySlot.append(el('p', { class: 'popup__bridge', text: event.bridge }));
  }

  /** Barra de progreso segmentada (un tramo por capítulo); cada paso se puede pulsar para saltar. */
  private progressBar(story: StoryViewState): HTMLElement {
    const timeline = this.timeline as Timeline;
    const path = story.path ?? [];
    const bar = el('ol', { class: 'progress', attrs: { 'aria-label': STRINGS.storyStepOf(story.index, story.total) } });
    let group: HTMLElement | null = null;
    let groupArc: string | null | undefined;
    path.forEach((id, index) => {
      const event = timeline.getEvent(id);
      const arc = event ? (timeline.arcOf(event)?.id ?? null) : null;
      // En la historia completa cada capítulo es un tramo; en la corta, un solo tramo.
      const key = story.mode === 'short' ? 'short' : arc;
      if (group === null || key !== groupArc) {
        group = el('li', { class: 'progress__chapter' });
        group.append(el('ol', { class: 'progress__steps' }));
        bar.append(group);
        groupArc = key;
      }
      const step = el('button', {
        class: `progress__step${index === story.index ? ' progress__step--current' : ''}${index < story.index ? ' progress__step--done' : ''}`,
        attrs: { type: 'button', 'aria-label': STRINGS.storyJump(index, event?.labelTitle ?? id), 'aria-current': index === story.index ? 'step' : undefined },
      });
      step.addEventListener('click', () => this.handlers?.onStoryStart(id, story.mode ?? 'full'));
      (group.firstElementChild as HTMLElement).append(el('li', {}, [step]));
    });
    // Cada tramo ocupa en proporción a sus pasos.
    for (const chapter of bar.children) (chapter as HTMLElement).style.flexGrow = String(chapter.querySelectorAll('.progress__step').length);
    return bar;
  }

  private fill(event: LifeEvent): void {
    const timeline = this.timeline as Timeline;
    // Un solo código de color: el de la línea vital del evento (las categorías van en neutro).
    const accent = timeline.lineColorOf(event.branch) ?? '#9fd8ff';
    this.root.style.setProperty('--accent', accent);
    clear(this.body);

    const context = [event.formatDateRange(timeline.meta.locale, STRINGS.present), event.location, event.organization]
      .filter((part): part is string => Boolean(part?.trim()))
      // Lo que ya dice el subtítulo no se repite en la línea de contexto («Donostia / San Sebastián»
      // cuenta como dicho si el subtítulo dice «Donostia»).
      .filter((part, i) => i === 0 || !(event.subtitle ?? '').toLowerCase().includes(part.split(/\s[/(,]\s?|\s·\s/)[0].trim().toLowerCase()));
    // El rótulo de la escena y el título de la ficha son «el mismo nombre»: si el corto no es un
    // recorte del largo, va como antetítulo.
    const kicker = event.shortTitle && !event.title.toLowerCase().includes(event.shortTitle.toLowerCase()) ? event.shortTitle : null;
    const links = event.links
      .map((link) => safeLink(`${link.label} ↗`, link.url, 'popup__link'))
      .filter((link): link is HTMLAnchorElement => link !== null);

    append(
      this.body,
      el('p', { class: 'popup__context', text: context.join(' · ') }),
      kicker ? el('p', { class: 'popup__kicker', text: kicker }) : null,
      el('h2', { class: 'popup__title', text: event.title, attrs: { id: 'popup-title' } }),
      event.subtitle ? el('p', { class: 'popup__subtitle', text: event.subtitle }) : null,
      this.badges(event),
      links.length > 0
        ? el('ul', { class: 'popup__links popup__links--top' }, links.slice(0, PRIMARY_LINKS).map((link) => el('li', {}, [link])))
        : null,
      el('p', { class: 'popup__summary', text: event.summary }),
      event.skills.length > 0
        ? el('ul', { class: 'popup__skills', attrs: { 'aria-label': STRINGS.skills } }, event.skills.map((skill) => el('li', { text: skill })))
        : null,
      ...event.paragraphs.map((paragraph) => el('p', { class: 'popup__paragraph', text: paragraph })),
      this.listSection(STRINGS.highlights, event.highlights, 'popup__highlights'),
      this.mediaSection(event),
      links.length > PRIMARY_LINKS
        ? el('section', { class: 'popup__section' }, [
            el('h3', { text: STRINGS.links }),
            el('ul', { class: 'popup__links' }, links.slice(PRIMARY_LINKS).map((link) => el('li', {}, [link]))),
          ])
        : null,
      // En la historia, «Viene de… / Esto llevó a…» sacarían del recorrido: solo en modo libre.
      this.inStory ? null : this.causalSection(STRINGS.cameFrom, timeline.causesOf(event.id), 'popup__causes'),
      this.inStory ? null : this.causalSection(STRINGS.ledTo, timeline.consequencesOf(event.id), 'popup__consequences'),
      this.footerMeta(event),
    );
  }

  /** Solo estados que importan: en activo, en curso, privado. */
  private badges(event: LifeEvent): HTMLElement | null {
    const badges = [
      event.active ? el('span', { class: 'badge badge--live badge--active', text: STRINGS.active }) : null,
      event.ongoing && !event.active ? el('span', { class: 'badge badge--live', text: STRINGS.ongoing }) : null,
      event.isPrivate ? el('span', { class: 'badge', text: STRINGS.privateEvent }) : null,
    ].filter((badge): badge is HTMLSpanElement => badge !== null);
    return badges.length > 0 ? el('div', { class: 'popup__badges' }, badges) : null;
  }

  /** Al pie y en pequeño: líneas (puntos de color, «5 de 7 líneas» en un cruce), categorías y capítulo. */
  private footerMeta(event: LifeEvent): HTMLElement {
    const timeline = this.timeline as Timeline;
    const lines = timeline.lines.filter((line) => !line.ghost);
    const own = new Set(event.lineIds);
    const lineRow = el('p', { class: 'popup__lines' });
    if (event.isUnion && lines.length > 0) {
      lineRow.append(
        el('span', { class: 'popup__dots', attrs: { 'aria-hidden': 'true' } }, lines.map((line) => {
          const dot = el('span', { class: `dot${own.has(line.id) ? ' dot--on' : ''}`, attrs: { title: line.label } });
          dot.style.setProperty('--dot', timeline.lineColorOf(line.id) ?? '#9fd8ff');
          return dot;
        })),
        el('span', { text: `${STRINGS.linesCount(event.lineIds.length, lines.length)}: ${event.lineIds.map((id) => timeline.getLine(id)?.label ?? id).join(', ')}` }),
      );
    } else {
      const line = timeline.getLine(event.branch);
      const origin = event.branchFrom ? timeline.getEvent(event.branchFrom) : undefined;
      const dot = el('span', { class: 'dot dot--on', attrs: { 'aria-hidden': 'true' } });
      dot.style.setProperty('--dot', timeline.lineColorOf(event.branch) ?? '#9fd8ff');
      if (line) lineRow.append(dot, el('span', { class: 'badge--line', text: STRINGS.lineOf(line.label) }));
      else if (origin) lineRow.append(dot, el('span', { class: 'badge--branch', text: STRINGS.branchFrom(origin.title) }));
    }
    const arc = this.inStory ? undefined : timeline.arcOf(event);
    const categories = timeline.categoriesOf(event).map((category) => category.label);
    return el('footer', { class: 'popup__meta' }, [
      lineRow.childElementCount > 0 ? lineRow : null,
      el('p', { class: 'popup__tags' }, [
        categories.length > 0 ? el('span', { class: 'popup__categories', text: categories.join(' · ') }) : null,
        arc ? el('span', { class: 'popup__chapter', text: STRINGS.arcOf(arc.title) }) : null,
      ]),
    ]);
  }

  private listSection(title: string, items: readonly string[], className: string): HTMLElement | null {
    if (items.length === 0) return null;
    return el('section', { class: 'popup__section' }, [
      el('h3', { text: title }),
      el('ul', { class: className }, items.map((item) => el('li', { text: item }))),
    ]);
  }

  /** «Esto llevó a…» / «Viene de…»: tarjetas con el color de la línea de destino que abren su ficha. */
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

  /** Degradado e indicador «Hay más abajo» mientras quede contenido por debajo del pie. */
  private updateMore(): void {
    const { scrollHeight, scrollTop, clientHeight } = this.body;
    const more = scrollHeight - scrollTop - clientHeight > 8;
    this.root.classList.toggle('popup--more', more);
  }

  private setExpanded(expanded: boolean): void {
    this.root.classList.toggle('popup--expanded', expanded);
    this.handle.setAttribute('aria-expanded', String(expanded));
    this.updateMore();
  }

  /** Hoja inferior (móvil): arrastrar el asa hacia arriba la amplía; hacia abajo, la reduce o la cierra. */
  private bindSwipe(): void {
    let startY: number | null = null;
    this.handle.addEventListener('pointerdown', (event) => {
      startY = event.clientY;
      this.handlePressed = true;
    });
    this.handle.addEventListener('pointerup', (event) => {
      if (startY === null) return;
      const dy = event.clientY - startY;
      startY = null;
      this.dragged = Math.abs(dy) > 10;
      if (dy < -30) this.setExpanded(true);
      else if (dy > SWIPE_CLOSE_PX) {
        if (this.root.classList.contains('popup--expanded')) this.setExpanded(false);
        else if (this.inStory) this.handlers?.onStoryExit();
        else this.handlers?.onDetailClosed();
      }
    });
  }

  private onOutsidePointer(event: Event): void {
    if (this.openEventId === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.root.contains(target) || target.closest(this.keepOpenSelector)) return;
    this.handlers?.onDetailClosed();
  }
}
