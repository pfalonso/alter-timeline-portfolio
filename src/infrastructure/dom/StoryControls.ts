import type { SelectionViewState, StoryMode, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import { arcYears, type Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { contactActions } from './contactActions';
import { append, clear, el } from './dom';
import { icon } from './icons';
import { STRINGS } from './strings';

export interface StoryControlsOptions {
  /**
   * Contenedor de la app: recibe `app--story` mientras dura el recorrido, `app--chapter` mientras se
   * ve la tarjeta de capítulo (la ficha espera) y `app--story-end` en la pantalla de cierre.
   */
  readonly app?: HTMLElement;
  /** Dónde devolver el foco al pasar la tarjeta de capítulo (la ficha). */
  readonly focusAfterCard?: () => HTMLElement | null;
  /** Botón secundario «Historia completa» (si hay versión corta). */
  readonly fullButton?: HTMLButtonElement | null;
  /** Pantalla de cierre del recorrido. */
  readonly endCard?: HTMLElement | null;
  /** Segundos estimados de lectura por paso (para la duración del botón). */
  readonly secondsPerStep?: number;
}

/**
 * Modo historia en la interfaz: botón principal («Te lo cuento en 1 minuto», la versión corta) y
 * acceso secundario a la historia completa; tarjeta de capítulo como momento propio (la ficha
 * espera hasta «Empezar capítulo») y pantalla de cierre con lo que hago hoy y cómo contactar.
 */
export class StoryControls implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private active = false;
  private mode: StoryMode = 'full';
  private lastStepId: string | null = null;
  private wasEnded = false;
  private readonly cardBody = el('div', { class: 'chapter__body' });
  private readonly continueButton = el('button', { class: 'chapter__continue', attrs: { type: 'button' } }, [
    el('span', { text: STRINGS.storyChapterStart }),
    icon('arrow'),
  ]);

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly card: HTMLElement,
    private readonly options: StoryControlsOptions = {},
  ) {
    button.hidden = true;
    button.type = 'button';
    button.addEventListener('click', () => this.handlers?.onStoryStart(undefined, this.primaryMode()));
    const full = options.fullButton;
    if (full) {
      full.hidden = true;
      full.type = 'button';
      full.addEventListener('click', () => this.handlers?.onStoryStart(undefined, 'full'));
    }

    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.append(this.cardBody, el('div', { class: 'chapter__actions' }, [this.continueButton]));
    this.continueButton.addEventListener('click', () => this.dismissCard(true));
    if (options.endCard) {
      options.endCard.hidden = true;
      options.endCard.setAttribute('role', 'dialog');
      options.endCard.setAttribute('aria-labelledby', 'story-end-title');
    }
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    const timeline = model.timeline;
    this.timeline = timeline;
    const short = timeline.storyShortPath.length;
    const full = timeline.storyPath.length;
    const seconds = this.options.secondsPerStep ?? 10;
    this.button.hidden = short === 0 && full === 0;
    clear(this.button);
    const primaryTitle = short > 0 ? (timeline.storyShortTitle ?? STRINGS.storyShort) : (timeline.storyTitle ?? STRINGS.storyFull);
    const steps = short > 0 ? short : full;
    this.button.append(
      el('span', { class: 'cta__label', text: primaryTitle }),
      el('span', { class: 'cta__meta', text: STRINGS.storyDuration(steps * seconds) }),
      icon('arrow', 'icon cta__icon'),
    );
    this.button.title = STRINGS.storyShortHint;
    const fullButton = this.options.fullButton;
    if (fullButton) {
      fullButton.hidden = short === 0 || full === 0;
      fullButton.textContent = STRINGS.storyFull;
      fullButton.title = STRINGS.storyFullHint;
    }
    this.renderEnd(timeline);
  }

  get cardVisible(): boolean {
    return !this.card.hidden;
  }

  get endVisible(): boolean {
    return this.options.endCard ? !this.options.endCard.hidden : false;
  }

  applySelection(state: SelectionViewState): void {
    const story = state.story;
    this.active = story !== undefined;
    this.mode = story?.mode ?? 'full';
    this.button.setAttribute('aria-pressed', String(this.active));
    this.options.app?.classList.toggle('app--story', this.active);
    this.options.app?.classList.toggle('app--story-short', this.active && this.mode === 'short');
    this.setEnded(story?.ended === true);
    if (!story) {
      this.lastStepId = null;
      this.dismissCard(false);
      return;
    }
    if (story.ended) {
      this.dismissCard(false);
      return;
    }
    // La tarjeta solo aparece al llegar a un paso nuevo que abre capítulo; cualquier otro paso la pasa.
    if (story.eventId === this.lastStepId) return;
    this.lastStepId = story.eventId;
    const arc = story.newChapter && story.arcId ? this.timeline?.getArc(story.arcId) : undefined;
    if (arc && this.timeline) this.showCard(arc.id);
    else this.dismissCard(false);
  }

  /** Recorrido del botón principal: el corto si existe. */
  private primaryMode(): StoryMode {
    return (this.timeline?.storyShortPath.length ?? 0) > 0 ? 'short' : 'full';
  }

  private showCard(arcId: string): void {
    const timeline = this.timeline as Timeline;
    const index = timeline.arcs.findIndex((arc) => arc.id === arcId);
    const arc = timeline.arcs[index];
    clear(this.cardBody);
    this.cardBody.append(
      el('p', { class: 'chapter__kicker', text: `${STRINGS.chapterOf(index, timeline.arcs.length)} · ${arcYears(arc, STRINGS.today)}` }),
      el('h2', { class: 'chapter__title', text: arc.title, attrs: { id: 'chapter-title' } }),
    );
    this.card.setAttribute('aria-labelledby', 'chapter-title');
    if (arc.subtitle) this.cardBody.append(el('p', { class: 'chapter__subtitle', text: arc.subtitle }));
    if (arc.summary) this.cardBody.append(el('p', { class: 'chapter__summary', text: arc.summary }));
    const wasHidden = this.card.hidden;
    this.card.hidden = false;
    this.options.app?.classList.add('app--chapter');
    this.card.classList.remove('chapter--enter');
    void this.card.offsetWidth; // reinicia la animación de entrada
    this.card.classList.add('chapter--enter');
    // La tarjeta es un momento propio: el foco va a su único botón (Enter/Espacio para seguir).
    if (wasHidden || !this.card.contains(document.activeElement)) this.continueButton.focus({ preventScroll: true });
  }

  private dismissCard(byUser: boolean): void {
    this.options.app?.classList.remove('app--chapter');
    if (this.card.hidden) return;
    const hadFocus = this.card.contains(document.activeElement);
    this.card.hidden = true;
    if (byUser || hadFocus) this.options.focusAfterCard?.()?.focus({ preventScroll: true });
  }

  private setEnded(ended: boolean): void {
    const end = this.options.endCard;
    this.options.app?.classList.toggle('app--story-end', ended);
    if (!end) return;
    end.hidden = !ended;
    if (ended && !this.wasEnded) {
      end.classList.remove('story-end--enter');
      void end.offsetWidth;
      end.classList.add('story-end--enter');
      end.querySelector<HTMLElement>('.story-end__actions a, .story-end__actions button')?.focus({ preventScroll: true });
    }
    this.wasEnded = ended;
    end.querySelector<HTMLElement>('[data-end="full"]')?.toggleAttribute('hidden', this.mode !== 'short' || (this.timeline?.storyPath.length ?? 0) === 0);
  }

  /** Pantalla de cierre: lo que hago hoy (oficio y disponibilidad), contacto y qué hacer después. */
  private renderEnd(timeline: Timeline): void {
    const end = this.options.endCard;
    if (!end) return;
    clear(end);
    const { meta } = timeline;
    const button = (text: string, kind: string, action: () => void, primary = false): HTMLButtonElement => {
      const node = el('button', { class: `story-end__button${primary ? ' story-end__button--primary' : ''}`, text, attrs: { type: 'button', 'data-end': kind } });
      node.addEventListener('click', action);
      return node;
    };
    const actions = contactActions(meta, 'action action--large');
    append(
      end,
      el('p', { class: 'story-end__kicker', text: STRINGS.endKicker }),
      el('h2', { class: 'story-end__title', text: meta.headline ?? STRINGS.endTitle, attrs: { id: 'story-end-title' } }),
      meta.availability || meta.location
        ? el('p', { class: 'story-end__where', text: [meta.location, meta.availability].filter(Boolean).join(' · ') })
        : null,
      actions.length > 0 ? el('div', { class: 'story-end__actions actions' }, actions) : null,
      el('div', { class: 'story-end__next' }, [
        button(STRINGS.endFull, 'full', () => this.handlers?.onStoryStart(undefined, 'full'), true),
        button(STRINGS.endExplore, 'explore', () => this.handlers?.onStoryExit()),
        button(STRINGS.endRestart, 'restart', () => this.handlers?.onStoryStart(undefined, this.mode)),
      ]),
    );
  }
}
