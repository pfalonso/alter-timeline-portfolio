import type { TimelineFactory, TimelineLayout } from '../../domain/services';
import type { TimelineRepository, TimelineViewModel } from '../ports';

export interface LoadTimelineOptions {
  readonly includePrivate: boolean;
  /** Reloj inyectado: devuelve "ahora". */
  readonly clock: () => Date;
}

/** Carga los datos, construye el agregado y calcula su disposición espacial. */
export class LoadTimeline {
  constructor(
    private readonly repository: TimelineRepository,
    private readonly factory: TimelineFactory,
    private readonly layout: TimelineLayout,
    private readonly options: LoadTimelineOptions,
  ) {}

  async execute(): Promise<TimelineViewModel> {
    const loaded = await this.repository.load();
    const timeline = this.factory.create(loaded.data, {
      includePrivate: this.options.includePrivate,
      now: this.options.clock(),
    });
    return { timeline, layout: this.layout.compute(timeline), source: loaded.source };
  }
}
