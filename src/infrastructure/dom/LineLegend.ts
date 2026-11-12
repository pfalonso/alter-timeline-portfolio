import type { TimelineViewModel } from '../../application/ports';
import type { LineStyle, Timeline } from '../../domain/model';
import type { BraidSpan } from '../../domain/services';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/** Estados que se ocultan mientras la línea va por la trenza (no aplican en ese tramo). */
const STATUS_CLASS = new Map<string, string>([
  [STRINGS.latent, ' line__status--latent'],
  [STRINGS.closedLine, ' line__status--closed'],
]);

/** Quien resalta la línea en la escena (la vista three). */
export interface BranchHighlighter {
  highlightBranch(id: string | null): void;
}

export interface LineLegendOptions {
  /** Color de la línea central si no declara uno (el del tronco en la escena). */
  readonly fallbackColor: string;
}

interface LegendLine {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly main: boolean;
  readonly style: LineStyle;
  readonly status: string | null;
  readonly description?: string;
}

/**
 * Leyenda de líneas vitales: color y nombre de cada línea. Las que viajan por la trenza en la zona
 * que mira la cámara se marcan «en foco ahora» (se actualiza al recorrer el tiempo). Pasar el ratón (o el foco de teclado) por una línea la resalta en la escena; un clic la
 * deja fijada (`aria-pressed`). En móvil se pliega tras un botón. Solo aparece si los datos declaran
 * `branches`.
 */
export class LineLegend implements TimelineViewPart, ProjectionListener {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private spans: readonly BraidSpan[] = [];
  private braided = '';
  private pinned: string | null = null;
  private hovered: string | null = null;
  private toggle: HTMLButtonElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly highlighter: BranchHighlighter | null,
    private readonly options: LineLegendOptions,
  ) {}

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.buttons.clear();
    this.spans = model.layout.braidSpans;
    this.braided = '';
    this.pinned = null;
    this.hovered = null;
    const lines = this.linesOf(model);
    this.root.hidden = lines.length === 0;
    if (lines.length === 0) return;

    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', STRINGS.linesLabel);
    this.root.classList.add('lines--collapsed');
    const listId = `${this.root.id || 'lines'}-list`;
    this.toggle = el('button', {
      class: 'lines__toggle',
      text: STRINGS.linesToggle(lines.length),
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': listId },
    });
    this.toggle.addEventListener('click', () => this.setExpanded(this.root.classList.contains('lines--collapsed')));

    const list = el('ul', { class: 'lines__list', attrs: { id: listId } });
    for (const line of lines) {
      const button = el(
        'button',
        {
          class: `line${line.main ? ' line--main' : ''}`,
          attrs: {
            type: 'button',
            'aria-pressed': 'false',
            'data-branch': line.id,
            title: line.description ?? STRINGS.lineHint,
          },
        },
        [
          el('span', { class: `line__mark line__mark--${line.style}`, attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'line__swatch', attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'line__label', text: line.label }),
          line.status
            ? el('span', { class: `line__status${STATUS_CLASS.get(line.status) ?? ''}`, text: line.status })
            : null,
          el('span', { class: 'line__now', text: STRINGS.inBraidNow, attrs: { hidden: '' } }),
        ],
      );
      button.style.setProperty('--line-color', line.color);
      button.addEventListener('pointerenter', () => this.hover(line.id));
      button.addEventListener('pointerleave', () => this.hover(null));
      button.addEventListener('focus', () => this.hover(line.id));
      button.addEventListener('blur', () => this.hover(null));
      button.addEventListener('click', () => this.pin(this.pinned === line.id ? null : line.id));
      this.buttons.set(line.id, button);
      list.append(el('li', { class: 'lines__item' }, [button]));
    }
    this.root.append(el('span', { class: 'lines__title', text: STRINGS.linesLabel }), this.toggle, list);
    const keys = this.keysOf(model);
    if (keys) this.root.append(keys);
  }

  /** Marca las líneas que van por la trenza donde mira la cámara. */
  onProjected(frame: ProjectedFrame): void {
    if (frame.lookX === undefined || this.spans.length === 0) return;
    const x = frame.lookX;
    const span =
      this.spans.find((item) => x >= item.startX && x <= item.endX) ??
      (x < this.spans[0].startX ? this.spans[0] : this.spans[this.spans.length - 1]);
    this.setBraided(span.members);
  }

  /** Líneas en la trenza ahora mismo (según la última proyección). */
  get braidedLines(): string[] {
    return this.braided === '' ? [] : this.braided.split('|');
  }

  private setBraided(members: readonly string[]): void {
    const key = members.join('|');
    if (key === this.braided) return;
    this.braided = key;
    for (const [lineId, button] of this.buttons) {
      const on = members.includes(lineId);
      button.classList.toggle('line--braided', on);
      const badge = button.querySelector<HTMLElement>('.line__now');
      if (badge) badge.hidden = !on;
    }
  }

  /** Despliega o pliega la lista (solo tiene efecto visual en móvil). */
  setExpanded(expanded: boolean): void {
    this.root.classList.toggle('lines--collapsed', !expanded);
    this.toggle?.setAttribute('aria-expanded', String(expanded));
  }

  /** Línea resaltada ahora mismo (por hover/foco o fijada con un clic). */
  get highlighted(): string | null {
    return this.hovered ?? this.pinned;
  }

  private hover(id: string | null): void {
    this.hovered = id;
    this.sync();
  }

  private pin(id: string | null): void {
    this.pinned = id;
    for (const [lineId, button] of this.buttons) button.setAttribute('aria-pressed', String(lineId === id));
    this.sync();
  }

  private sync(): void {
    const active = this.highlighted;
    for (const [lineId, button] of this.buttons) button.classList.toggle('line--active', lineId === active);
    this.root.classList.toggle('lines--highlighting', active !== null);
    this.highlighter?.highlightBranch(active);
  }

  /** Claves pequeñas para lo que aparece en los datos: encrucijadas, activos y caminos que no fueron. */
  private keysOf(model: TimelineViewModel): HTMLElement | null {
    const { layout } = model;
    const keys: [string, string, string][] = [];
    if (layout.nodes.some((node) => node.lines.length > 1)) keys.push(['union', STRINGS.keyUnion, STRINGS.keyUnionHint]);
    if (layout.actives.length > 0) keys.push(['active', STRINGS.keyActive, STRINGS.keyActiveHint]);
    if (layout.ghosts.length > 0) keys.push(['ghost', STRINGS.keyGhost, STRINGS.keyGhostHint]);
    if (keys.length === 0) return null;
    return el(
      'ul',
      { class: 'lines__keys' },
      keys.map(([kind, label, hint]) =>
        el('li', { class: `key key--${kind}`, attrs: { title: hint } }, [
          el('span', { class: `key__icon key__icon--${kind}`, attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'key__label', text: label }),
        ]),
      ),
    );
  }

  private linesOf(model: TimelineViewModel): LegendLine[] {
    const { timeline, layout } = model;
    if (timeline.lines.length === 0) return [];
    return layout.branches.map((branch) => {
      const line = timeline.getLine(branch.id);
      const color = timeline.lineColorOf(branch.id) ?? this.options.fallbackColor;
      return {
        id: branch.id,
        label: line?.label ?? (branch.main ? STRINGS.mainLine : branch.id),
        color,
        main: branch.main,
        style: timeline.lineStyleOf(branch.id),
        status: this.statusOf(timeline, branch),
        description: line?.description,
      };
    });
  }

  private statusOf(timeline: Timeline, branch: TimelineViewModel['layout']['branches'][number]): string | null {
    if (branch.merge) return STRINGS.mergesInto(timeline.getLine(branch.merge.into)?.label ?? branch.merge.into);
    if (timeline.getLine(branch.id)?.untilPresent) return STRINGS.latent;
    return branch.open ? null : STRINGS.closedLine;
  }
}
