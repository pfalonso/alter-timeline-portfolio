import type { SelectionViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import { arcYears, type Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

export interface StoryControlsOptions {
  /** Contenedor de la app: recibe `app--story` mientras dura el recorrido (la interfaz se recoge). */
  readonly app?: HTMLElement;
  /** Dónde devolver el foco al pasar la tarjeta de capítulo (el pop-up). */
  readonly focusAfterCard?: () => HTMLElement | null;
}

/**
 * Modo historia en la interfaz: botón «Ver la historia» (solo si hay recorrido) que pasa a «Salir
 * de la historia», y tarjeta breve de capítulo al entrar en un arco nuevo, que se puede pasar.
 */
export class StoryControls implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private active = false;
  private lastStepId: string | null = null;
  private readonly cardBody = el('div', { class: 'chapter__body' });
  private readonly continueButton = el('button', {
    class: 'chapter__continue',
    attrs: { type: 'button' },
    text: `${STRINGS.storyContinue} →`,
  });

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly card: HTMLElement,
    private readonly options: StoryControlsOptions = {},
  ) {
    button.hidden = true;
    button.type = 'button';
    button.textContent = STRINGS.storyStart;
    button.title = STRINGS.storyStartHint;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => (this.active ? this.handlers?.onStoryExit() : this.handlers?.onStoryStart()));

    card.hidden = true;
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.append(
      this.cardBody,
      el('div', { class: 'chapter__actions' }, [
        this.continueButton,
        el('span', { class: 'chapter__hint', text: STRINGS.storyEscHint }),
      ]),
    );
    this.continueButton.addEventListener('click', () => this.dismissCard(true));
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
    this.button.hidden = model.timeline.storyPath.length === 0;
  }

  get cardVisible(): boolean {
    return !this.card.hidden;
  }

  applySelection(state: SelectionViewState): void {
    const story = state.story;
    this.active = story !== undefined;
    this.button.textContent = this.active ? STRINGS.storyExit : STRINGS.storyStart;
    this.button.setAttribute('aria-pressed', String(this.active));
    this.options.app?.classList.toggle('app--story', this.active);
    if (!story) {
      this.lastStepId = null;
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

  private showCard(arcId: string): void {
    const timeline = this.timeline as Timeline;
    const index = timeline.arcs.findIndex((arc) => arc.id === arcId);
    const arc = timeline.arcs[index];
    clear(this.cardBody);
    this.cardBody.append(
      el('p', { class: 'chapter__kicker', text: `${STRINGS.chapterOf(index, timeline.arcs.length)} · ${arcYears(arc, STRINGS.today)}` }),
      el('h2', { class: 'chapter__title', text: arc.title }),
    );
    if (arc.subtitle) this.cardBody.append(el('p', { class: 'chapter__subtitle', text: arc.subtitle }));
    if (arc.summary) this.cardBody.append(el('p', { class: 'chapter__summary', text: arc.summary }));
    this.card.hidden = false;
    this.card.classList.remove('chapter--enter');
    void this.card.offsetWidth; // reinicia la animación de entrada
    this.card.classList.add('chapter--enter');
  }

  private dismissCard(byUser: boolean): void {
    if (this.card.hidden) return;
    const hadFocus = this.card.contains(document.activeElement);
    this.card.hidden = true;
    if (byUser || hadFocus) this.options.focusAfterCard?.()?.focus({ preventScroll: true });
  }
}
