import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

export interface PersonalDataPluginOptions {
  /** Ruta (relativa a la raíz del proyecto) del JSON personal. */
  readonly file?: string;
  /** URL pública bajo la que se sirve. */
  readonly route?: string;
}

/**
 * Sirve `./data/life.json` (fuera de `public/`, ignorado por git) en `/data/life.json`
 * durante `vite dev` y `vite preview`. Si el fichero no existe responde 404 para que
 * el cliente active el fallback a los datos de ejemplo.
 */
export function personalDataPlugin(options: PersonalDataPluginOptions = {}): Plugin {
  const route = options.route ?? '/data/life.json';
  let filePath = resolve(options.file ?? 'data/life.json');

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== route) {
      next();
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end('{"error":"life.json not found"}');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(filePath).pipe(res);
  };

  return {
    name: 'alter-timeline:personal-data',
    configResolved(config) {
      filePath = resolve(config.root, options.file ?? 'data/life.json');
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
