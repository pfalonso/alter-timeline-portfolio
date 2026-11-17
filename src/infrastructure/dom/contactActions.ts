import type { LifeMetaData } from '../../domain/model';
import { isHttpUrl, isSitePath } from '../../domain/services';
import { el } from './dom';
import { icon, iconForLink } from './icons';
import { STRINGS } from './strings';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Enlace a un documento: URL http(s) o ruta del propio sitio (`/cv/…`). Nunca otro esquema. */
function documentLink(label: string, url: string, className: string): HTMLAnchorElement | null {
  if (!isHttpUrl(url) && !isSitePath(url)) return null;
  const link = el('a', { class: className }, [icon(iconForLink(label, url)), el('span', { text: label })]);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/** Correo visible como texto (seleccionable), enlace `mailto:` y botón de copiar. */
export function emailAction(email: string, className: string): HTMLElement | null {
  if (!EMAIL.test(email)) return null;
  const link = el('a', { class: `${className} action--email` }, [icon('mail'), el('span', { class: 'action__text', text: email })]);
  link.href = `mailto:${email}`;
  const copy = el('button', {
    class: 'action__copy',
    attrs: { type: 'button', 'aria-label': STRINGS.copyEmailLabel(email), title: STRINGS.copyEmail },
  }, [icon('copy')]);
  copy.addEventListener('click', () => {
    const done = (): void => {
      copy.classList.add('action__copy--done');
      copy.setAttribute('title', STRINGS.copied);
    };
    // El portapapeles puede no estar disponible (http, permisos): el texto sigue siendo seleccionable.
    void navigator.clipboard?.writeText(email).then(done, () => undefined);
  });
  return el('span', { class: 'action-group' }, [link, copy]);
}

/**
 * Acciones de contacto en el orden que busca quien contrata: demo reel, CV, correo y después el
 * resto de enlaces (GitHub, LinkedIn, ArtStation…). Las usan la cabecera y el cierre de la historia.
 */
export function contactActions(meta: Readonly<LifeMetaData>, className = 'action'): HTMLElement[] {
  const contact = meta.contact ?? [];
  const isReel = (label: string, url: string): boolean => iconForLink(label, url) === 'play';
  const reels = contact.filter((item) => isReel(item.label, item.url));
  const rest = contact.filter((item) => !isReel(item.label, item.url));
  const links = (items: readonly { label: string; url: string }[], extra = ''): HTMLElement[] =>
    items
      .map((item) => documentLink(item.label, item.url, `${className}${extra}`))
      .filter((link): link is HTMLAnchorElement => link !== null);
  return [
    ...links(reels, ` ${className}--primary`),
    ...links(meta.cv ?? []),
    meta.email ? emailAction(meta.email, className) : null,
    ...links(rest),
  ].filter((item): item is HTMLElement => item !== null);
}
