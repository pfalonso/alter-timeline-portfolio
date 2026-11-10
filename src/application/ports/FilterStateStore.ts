/** Puerto de salida: persiste qué categorías están activas (p. ej. en la URL). */
export interface FilterStateStore {
  /** `null` = no hay filtro guardado (todas activas). */
  load(): string[] | null;
  save(activeCategoryIds: string[] | null): void;
}
