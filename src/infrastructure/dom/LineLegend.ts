import type { FilterViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
import type { BraidSpan, TimelineLayoutResult } from '../../domain/services';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/** Quien resalta la línea en la escena (la vista three). */
export interface BranchHighlighter {
  highlightBranch(id: string | null): void;
}

export interface LineLegendOptions {
  /** Color de la línea central si no declara uno (el del tronco en la escena). */
  readonly fallbackColor: string;
  /** Dónde van las claves de lectura (encrucijada, en activo…); por defecto, dentro de la leyenda. */
  readonly keysRoot?: HTMLElement | null;
  /** Reloj en ms (inyectable en tests). */
  readonly clock?: () => number;
  /**
   * El estado «en foco» solo cambia cuando la cámara lleva este tiempo (ms) mirando al mismo tramo:
   * mientras se viaja (o durante la apertura) la leyenda no parpadea.
   */
  readonly settleMs?: number;
}

interface LegendLine {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly main: boolean;
  readonly closed: boolean;
  readonly merge: string | null;
  readonly description?: string;
}

/**
 * Leyenda de líneas vitales y filtro de primer nivel: color y nombre de cada línea en una rejilla
 * fija (el estado nunca cambia la posición). «En foco» sale de los datos (periodos `focus` en la
 * fecha que mira la cámara; `layout.focusSpans`), no de qué líneas cruzan la banda; el rótulo lleva
 * el momento («En foco · hoy» si «hoy» está en pantalla; si no, el año del momento centrado).
 * Pulsar una línea la aísla (solo sus momentos); pasar el ratón o el foco la resalta en la escena y
 * muestra su descripción. Solo aparece si los datos declaran `branches`.
 */
export class LineLegend implements TimelineViewPart, ProjectionListener {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private spans: readonly BraidSpan[] = [];
  private nodeYears: { x: number; year: number }[] = [];
  private applied = '';
  private pending = '';
  private pendingSince = 0;
  private braided: readonly string[] = [];
  private isolated: string | null = null;
  private hovered: string | null = null;
  private readonly now = el('span', { class: 'lines__now', attrs: { 'aria-live': 'polite' } });
  private readonly description = el('p', { class: 'lines__desc', attrs: { 'aria-live': 'polite' } });

  constructor(
    private readonly root: HTMLElement,
    private readonly highlighter: BranchHighlighter | null,
    private readonly options: LineLegendOptions,
  ) {}

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.buttons.clear();
    this.timeline = model.timeline;
    this.useLayout(model.layout);
    this.applied = '';
    this.pending = '';
    this.braided = [];
    this.isolated = null;
    this.hovered = null;
    this.now.textContent = '';
    this.description.textContent = '';
    this.description.hidden = true;
    const lines = this.linesOf(model);
    this.root.hidden = lines.length === 0;
    if (this.options.keysRoot) clear(this.options.keysRoot);
    if (lines.length === 0) return;

    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', STRINGS.linesLabel);
    const list = el('ul', { class: 'lines__list', attrs: { id: `${this.root.id || 'lines'}-list` } });
    for (const line of lines) {
      const button = el(
        'button',
        {
          class: `line${line.main ? ' line--main' : ''}${line.closed ? ' line--closed' : ''}`,
          attrs: { type: 'button', 'aria-pressed': 'false', 'data-branch': line.id, title: STRINGS.lineHint },
        },
        [
          el('span', { class: 'line__swatch', attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'line__label', text: line.label }),
          line.merge ? el('span', { class: 'line__status', text: STRINGS.mergesInto(line.merge) }) : null,
          line.closed ? el('span', { class: 'line__status line__status--closed', text: STRINGS.closedLine }) : null,
          el('span', { class: 'line__focus visually-hidden', text: `, ${STRINGS.focusIn}`, attrs: { hidden: '' } }),
        ],
      );
      button.style.setProperty('--line-color', line.color);
      button.addEventListener('pointerenter', () => this.hover(line.id));
      button.addEventListener('pointerleave', () => this.hover(null));
      button.addEventListener('focus', () => this.hover(line.id));
      button.addEventListener('blur', () => this.hover(null));
      button.addEventListener('click', () => this.handlers?.onLineIsolated(this.isolated === line.id ? null : line.id));
      this.buttons.set(line.id, button);
      list.append(el('li', { class: 'lines__item' }, [button]));
    }
    this.root.append(
      el('p', { class: 'lines__head' }, [el('span', { class: 'lines__title', text: STRINGS.linesLabel }), this.now]),
      list,
      this.description,
    );
    const keys = this.keysOf(model);
    if (keys) (this.options.keysRoot ?? this.root).append(keys);
  }

  applyFilter(state: FilterViewState): void {
    if (state.layout) this.useLayout(state.layout);
    this.isolated = state.isolatedLine ?? null;
    for (const [id, button] of this.buttons) {
      const on = id === this.isolated;
      button.setAttribute('aria-pressed', String(on));
      button.title = on ? STRINGS.lineIsolated : STRINGS.lineHint;
    }
    this.root.classList.toggle('lines--isolating', this.isolated !== null);
    // Con el filtro, la composición del tramo puede cambiar: se vuelve a calcular.
    this.applied = '';
    this.pending = '';
  }

  /** Marca las líneas en foco en la fecha que mira la cámara (cuando la cámara se detiene). */
  onProjected(frame: ProjectedFrame): void {
    if (frame.lookX === undefined || this.spans.length === 0) return;
    const today = frame.nowX !== null && frame.nowX >= 0 && frame.nowX <= frame.viewport.width;
    const x = today ? Infinity : frame.lookX;
    const span = this.spanAt(x);
    const when = today ? STRINGS.today : this.yearAt(frame.lookX);
    const key = `${when}|${span.members.join('|')}`;
    const clock = this.options.clock ?? (() => performance.now());
    const settle = this.options.settleMs ?? 350;
    if (key !== this.pending) {
      this.pending = key;
      this.pendingSince = clock();
    }
    if (key === this.applied || clock() - this.pendingSince < settle) return;
    this.applied = key;
    this.setBraided(span.members, when);
  }

  /** Líneas en foco según la última proyección asentada. */
  get braidedLines(): string[] {
    return [...this.braided];
  }

  /** Línea resaltada ahora mismo (hover o foco de teclado). */
  get highlighted(): string | null {
    return this.hovered;
  }

  private useLayout(layout: TimelineLayoutResult): void {
    this.spans = layout.focusSpans;
    this.nodeYears = layout.nodes
      .map((node) => ({ x: node.position.x, year: this.timeline?.getEvent(node.eventId)?.start.year ?? 0 }))
      .sort((a, b) => a.x - b.x);
  }

  private spanAt(x: number): BraidSpan {
    const spans = this.spans;
    return spans.find((item) => x >= item.startX && x <= item.endX) ?? (x < spans[0].startX ? spans[0] : spans[spans.length - 1]);
  }

  /** Año del momento más cercano a la X que mira la cámara. */
  private yearAt(x: number): string {
    let best: { x: number; year: number } | null = null;
    for (const node of this.nodeYears) if (best === null || Math.abs(node.x - x) < Math.abs(best.x - x)) best = node;
    return best ? String(best.year) : STRINGS.today;
  }

  private setBraided(members: readonly string[], when: string): void {
    this.braided = members.filter((id) => this.buttons.has(id));
    const labels: string[] = [];
    for (const [lineId, button] of this.buttons) {
      const on = members.includes(lineId);
      button.classList.toggle('line--braided', on);
      const state = button.querySelector<HTMLElement>('.line__focus');
      if (state) state.hidden = !on;
      if (on) labels.push(button.querySelector('.line__label')?.textContent ?? lineId);
    }
    this.now.textContent = `${STRINGS.focusWhen(when)}: ${labels.join(', ')}`;
  }

  private hover(id: string | null): void {
    this.hovered = id;
    for (const [lineId, button] of this.buttons) button.classList.toggle('line--active', lineId === id);
    this.root.classList.toggle('lines--highlighting', id !== null);
    this.highlighter?.highlightBranch(id);
    const text = id === null ? '' : this.describe(id);
    this.description.textContent = text;
    this.description.hidden = text === '';
  }

  /** «Arte y creatividad — Dibujo, VFX… · En foco: 2022 – 2024». */
  private describe(id: string): string {
    const line = this.timeline?.getLine(id);
    if (!line) return '';
    const periods = line.focus.map((period) => {
      const end = period.end === null ? STRINGS.today : String(period.end.year);
      return end === String(period.start.year) ? end : `${period.start.year} – ${end}`;
    });
    return [line.description ? `${line.label}: ${line.description}` : line.label, periods.length ? STRINGS.focusPeriods(periods.join(', ')) : null]
      .filter(Boolean)
      .join(' · ');
  }

  /** Claves de lectura para lo que aparece en los datos: foco, encrucijadas, activos, caminos y arcos. */
  private keysOf(model: TimelineViewModel): HTMLElement | null {
    const { layout } = model;
    const keys: [string, string, string][] = [['focus', STRINGS.keyFocus, STRINGS.keyFocusHint]];
    if (layout.nodes.some((node) => node.lines.length > 1)) keys.push(['union', STRINGS.keyUnion, STRINGS.keyUnionHint]);
    if (layout.actives.length > 0) keys.push(['active', STRINGS.keyActive, STRINGS.keyActiveHint]);
    if (layout.ghosts.length > 0) keys.push(['ghost', STRINGS.keyGhost, STRINGS.keyGhostHint]);
    if (layout.links.length > 0) keys.push(['link', STRINGS.keyLink, STRINGS.keyLinkHint]);
    return el('div', { class: 'keys' }, [
      el('p', { class: 'keys__title', text: STRINGS.keysTitle }),
      el(
        'ul',
        { class: 'lines__keys' },
        keys.map(([kind, label, hint]) =>
          el('li', { class: `key key--${kind}` }, [
            el('span', { class: `key__icon key__icon--${kind}`, attrs: { 'aria-hidden': 'true' } }),
            el('span', { class: 'key__label', text: label }),
            el('span', { class: 'key__hint', text: hint }),
          ]),
        ),
      ),
    ]);
  }

  private linesOf(model: TimelineViewModel): LegendLine[] {
    const { timeline, layout } = model;
    if (timeline.lines.length === 0) return [];
    return layout.branches.map((branch) => {
      const line = timeline.getLine(branch.id);
      return {
        id: branch.id,
        label: line?.label ?? (branch.main ? STRINGS.mainLine : branch.id),
        color: timeline.lineColorOf(branch.id) ?? this.options.fallbackColor,
        main: branch.main,
        merge: branch.merge ? (timeline.getLine(branch.merge.into)?.label ?? branch.merge.into) : null,
        // «Cerrada» solo si de verdad termina (ni sigue hasta hoy ni se une a otra).
        closed: !branch.merge && !branch.open && line?.untilPresent !== true,
        description: line?.description,
      };
    });
  }
}
