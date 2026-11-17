/**
 * Iconos de trazo fino propios (sin emojis ni fuentes de iconos): SVG creados con el DOM, un solo
 * color (`currentColor`) y el mismo peso que el resto de la interfaz. Decorativos (`aria-hidden`).
 */
export type IconName =
  | 'play'
  | 'doc'
  | 'mail'
  | 'code'
  | 'person'
  | 'image'
  | 'link'
  | 'copy'
  | 'help'
  | 'plus'
  | 'minus'
  | 'expand'
  | 'list'
  | 'arrow'
  | 'close'
  | 'filter';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Trazos de cada icono en una caja de 24×24. */
const PATHS: Record<IconName, readonly string[]> = {
  play: ['M8 5.5v13l10.5-6.5z'],
  doc: ['M7 3.5h7l4 4v13H7z', 'M14 3.5v4h4', 'M9.5 12h6', 'M9.5 15.5h6'],
  mail: ['M3.5 6.5h17v11h-17z', 'M3.5 7l8.5 6.5L20.5 7'],
  code: ['M8.5 7.5L4 12l4.5 4.5', 'M15.5 7.5L20 12l-4.5 4.5', 'M13.5 5.5l-3 13'],
  person: ['M12 12a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z', 'M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5'],
  image: ['M3.5 5.5h17v13h-17z', 'M3.5 16l5-5 4 4 3-3 5 5', 'M15.5 9.25a1.25 1.25 0 1 0 0-.01'],
  link: ['M14 4.5h5.5V10', 'M19.5 4.5L11 13', 'M17 13.5v6H4.5V7h6'],
  copy: ['M8.5 8.5h11v11h-11z', 'M5.5 15.5h-1v-11h11v1'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.6', 'M12 16.6v.4'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5', 'M8 12h8'],
  list: ['M8.5 6.5h11', 'M8.5 12h11', 'M8.5 17.5h11', 'M4.5 6.5h.5', 'M4.5 12h.5', 'M4.5 17.5h.5'],
  arrow: ['M5 12h14', 'M13.5 6.5L19 12l-5.5 5.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  filter: ['M4 6.5h16', 'M7 12h10', 'M10 17.5h4'],
};

/** Crea un icono `<svg>` (16 px por defecto; el CSS puede cambiarlo). */
export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `${className} ${className}--${name}`);
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Icono que mejor describe un enlace de contacto por su texto o su dominio. */
export function iconForLink(label: string, url: string): IconName {
  const text = `${label} ${url}`.toLowerCase();
  if (/reel|youtu|vimeo|v[íi]deo/.test(text)) return 'play';
  if (/github|gitlab|c[óo]digo|code|repo/.test(text)) return 'code';
  if (/linkedin/.test(text)) return 'person';
  if (/artstation|behance|portfolio|dribbble/.test(text)) return 'image';
  if (/mailto:|correo|e-?mail/.test(text)) return 'mail';
  if (/\bcv\b|curr[íi]cul|\.pdf/.test(text)) return 'doc';
  return 'link';
}
