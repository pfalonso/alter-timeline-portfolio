export interface Category {
  readonly id: string;
  readonly label: string;
  /** Color hex `#RRGGBB`. */
  readonly color: string;
  readonly icon?: string;
  readonly description?: string;
}
