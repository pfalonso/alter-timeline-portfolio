import type { TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
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
}

interface LegendLine {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly main: boolean;
  readonly status: string | null;
  readonly description?: string;
}

/**
 * Leyenda de líneas vitales: color y nombre de cada línea, con la central marcada como «foco
 * actual». Pasar el ratón (o el foco de teclado) por una línea la resalta en la escena; un clic la
 * deja fijada (`aria-pressed`). En móvil se pliega tras un botón. Solo aparece si los datos declaran
 * `branches`.
 */
export class LineLegend implements TimelineViewPart {
  private readonly buttons = new Map<string, HTMLButtonElement>();
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
          el('span', { class: 'line__swatch', attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'line__label', text: line.label }),
          line.status ? el('span', { class: 'line__status', text: line.status }) : null,
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

  private linesOf(model: TimelineViewModel): LegendLine[] {
    const { timeline, layout } = model;
    if (timeline.lines.length === 0) return [];
    return layout.branches.map((branch) => {
      const line = timeline.getLine(branch.id);
      const color = (branch.main ? line?.color : timeline.lineColorOf(branch.id)) ?? this.options.fallbackColor;
      return {
        id: branch.id,
        label: line?.label ?? (branch.main ? STRINGS.mainLine : branch.id),
        color,
        main: branch.main,
        status: this.statusOf(timeline, branch),
        description: line?.description,
      };
    });
  }

  private statusOf(timeline: Timeline, branch: TimelineViewModel['layout']['branches'][number]): string | null {
    if (branch.main) return STRINGS.currentFocus;
    if (branch.merge) return STRINGS.mergesInto(timeline.getLine(branch.merge.into)?.label ?? branch.merge.into);
    if (timeline.getLine(branch.id)?.untilPresent) return STRINGS.latent;
    return branch.open ? null : STRINGS.closedLine;
  }
}
