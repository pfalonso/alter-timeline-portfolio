import type {
  FilterStateStore,
  FilterViewState,
  LoadedLifeData,
  SelectionViewState,
  TimelineRepository,
  TimelineView,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../src/application/ports';

/** Puerto de persistencia en memoria que registra cada guardado. */
export class InMemoryFilterStore implements FilterStateStore {
  readonly saved: (string[] | null)[] = [];

  constructor(private value: string[] | null = null) {}

  load(): string[] | null {
    return this.value;
  }

  save(activeCategoryIds: string[] | null): void {
    this.value = activeCategoryIds;
    this.saved.push(activeCategoryIds);
  }
}

export type ViewCall =
  | { readonly type: 'bind' }
  | { readonly type: 'render'; readonly model: TimelineViewModel }
  | { readonly type: 'filter'; readonly state: FilterViewState }
  | { readonly type: 'selection'; readonly state: SelectionViewState }
  | { readonly type: 'error'; readonly message: string };

/** Vista falsa: registra, en orden, todo lo que la aplicación le pide pintar. */
export class RecordingView implements TimelineView {
  readonly calls: ViewCall[] = [];
  handlers: TimelineViewHandlers | null = null;

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
    this.calls.push({ type: 'bind' });
  }

  render(model: TimelineViewModel): void {
    this.calls.push({ type: 'render', model });
  }

  applyFilter(state: FilterViewState): void {
    this.calls.push({ type: 'filter', state });
  }

  applySelection(state: SelectionViewState): void {
    this.calls.push({ type: 'selection', state });
  }

  showLoadError(message: string): void {
    this.calls.push({ type: 'error', message });
  }

  get types(): string[] {
    return this.calls.map((call) => call.type);
  }

  get lastFilter(): FilterViewState {
    const call = this.calls.filter((item) => item.type === 'filter').at(-1);
    if (!call) throw new Error('la vista no ha recibido ningún filtro');
    return call.state;
  }

  get lastSelection(): SelectionViewState {
    const call = this.calls.filter((item) => item.type === 'selection').at(-1);
    if (!call) throw new Error('la vista no ha recibido ninguna selección');
    return call.state;
  }

  count(type: ViewCall['type']): number {
    return this.calls.filter((call) => call.type === type).length;
  }
}

export class StubRepository implements TimelineRepository {
  calls = 0;

  constructor(private readonly result: LoadedLifeData | Error | string) {}

  load(): Promise<LoadedLifeData> {
    this.calls += 1;
    if (this.result instanceof Error || typeof this.result === 'string') return Promise.reject(this.result);
    return Promise.resolve(this.result);
  }
}
