/** `true` solo para URLs absolutas http(s) bien formadas. Función pura (usa `URL`, disponible en Node y navegador). */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Ruta relativa al propio sitio (`/cv/Pablo.pdf`): sin `//`, sin `..` y sin caracteres raros. */
export function isSitePath(url: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9._~%/-]+$/.test(url) && !url.split('/').includes('..');
}
