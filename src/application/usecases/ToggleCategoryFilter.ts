import type { CategorySelection } from '../../domain/model';
import type { FilterStateStore } from '../ports';

export type FilterAction =
  | { readonly type: 'toggle'; readonly categoryId: string }
  | { readonly type: 'only'; readonly categoryId: string }
  | { readonly type: 'all' }
  | { readonly type: 'none' };

/** Aplica una acción sobre el filtro de categorías y persiste el resultado. */
export class ToggleCategoryFilter {
  constructor(private readonly store: FilterStateStore) {}

  execute(current: CategorySelection, action: FilterAction): CategorySelection {
    const next = this.reduce(current, action);
    this.store.save(next.toPersisted());
    return next;
  }

  private reduce(current: CategorySelection, action: FilterAction): CategorySelection {
    switch (action.type) {
      case 'toggle':
        return current.toggle(action.categoryId);
      case 'only':
        // "Solo esta"; si ya era la única activa, vuelve a mostrarlas todas.
        return current.activeIds.size === 1 && current.has(action.categoryId)
          ? current.selectAll()
          : current.only(action.categoryId);
      case 'all':
        return current.selectAll();
      case 'none':
        return current.selectNone();
    }
  }
}
