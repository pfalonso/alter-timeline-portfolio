import { isHttpUrl } from '../../domain/services';

type Attrs = Record<string, string | number | boolean | undefined>;

/**
 * Crea un elemento. El texto SIEMPRE entra por `textContent` (nunca innerHTML),
 * así que el contenido del JSON no puede inyectar HTML.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { class?: string; text?: string; attrs?: Attrs } = {},
  children: readonly (Node | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** `append` que ignora los huecos (`null`/`undefined`). */
export function append(parent: Element, ...children: readonly (Node | null | undefined)[]): void {
  for (const child of children) if (child) parent.append(child);
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** Enlace externo seguro: solo http(s), nueva pestaña, sin opener ni referrer. Devuelve `null` si la URL no es válida. */
export function safeLink(label: string, url: string, className?: string): HTMLAnchorElement | null {
  if (!isHttpUrl(url)) return null;
  const link = el('a', { class: className, text: label });
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
