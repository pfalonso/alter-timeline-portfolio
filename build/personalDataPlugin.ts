import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

export interface PersonalDataPluginOptions {
  /** Ruta (relativa a la raíz del proyecto) del JSON personal. */
  readonly file?: string;
  /** URL pública bajo la que se sirve. */
  readonly route?: string;
  /** Directorio privado de los CV en PDF (relativo a la raíz). Por defecto `data/cv`. */
  readonly cvDir?: string;
  /** Prefijo público de los CV. Por defecto `/cv/`. */
  readonly cvRoute?: string;
}

/** Nombre de fichero de CV aceptado: un solo segmento, sin `..` ni barras, y extensión .pdf. */
export const CV_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/;

/**
 * Nombre de fichero seguro a partir de la ruta pedida bajo `prefix`, o `null` si no es un PDF de
 * un solo segmento (cualquier `..`, barra, barra invertida o escape raro → `null`).
 */
export function cvFileName(path: string, prefix = '/cv/'): string | null {
  if (!path.startsWith(prefix)) return null;
  let name: string;
  try {
    name = decodeURIComponent(path.slice(prefix.length));
  } catch {
    return null;
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  return CV_FILE.test(name) ? name : null;
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

/**
 * Middleware de datos privados: `/data/life.json` desde `data/life.json` y `/cv/<nombre>.pdf`
 * desde `data/cv/`. Lo que no existe (o no es un nombre válido) es 404; así el cliente cae a los
 * datos de ejemplo y un enlace a un CV ausente no rompe nada.
 */
export function createPersonalDataMiddleware(paths: {
  readonly file: string;
  readonly route: string;
  readonly cvDir: string;
  readonly cvRoute: string;
}): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === paths.route) {
      if (!isFile(paths.file)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end('{"error":"life.json not found"}');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(paths.file).pipe(res);
      return;
    }
    if (!path.startsWith(paths.cvRoute)) {
      next();
      return;
    }
    const name = cvFileName(path, paths.cvRoute);
    const file = name === null ? null : resolve(paths.cvDir, name);
    if (file === null || !isFile(file)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(file).pipe(res);
  };
}

/**
 * Sirve los datos privados (fuera de `public/`, ignorados por git) durante `vite dev` y
 * `vite preview`: `./data/life.json` en `/data/life.json` y `./data/cv/*.pdf` en `/cv/*.pdf`.
 */
export function personalDataPlugin(options: PersonalDataPluginOptions = {}): Plugin {
  const paths = {
    route: options.route ?? '/data/life.json',
    cvRoute: options.cvRoute ?? '/cv/',
    file: resolve(options.file ?? 'data/life.json'),
    cvDir: resolve(options.cvDir ?? 'data/cv'),
  };
  // El middleware lee `paths` en cada petición: `configResolved` puede cambiar la raíz.
  const middleware: Connect.NextHandleFunction = (req, res, next) => createPersonalDataMiddleware(paths)(req, res, next);

  return {
    name: 'alter-timeline:personal-data',
    configResolved(config) {
      paths.file = resolve(config.root, options.file ?? 'data/life.json');
      paths.cvDir = resolve(config.root, options.cvDir ?? 'data/cv');
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
