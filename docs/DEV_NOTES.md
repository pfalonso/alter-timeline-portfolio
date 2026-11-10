# Notas de desarrollo (agente 2)

Complementa a `docs/CONTRACT.md`. Aquí están las decisiones, las desviaciones respecto al contrato
y cómo comprobar la interfaz de forma automática.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Vite en desarrollo. Sirve `./data/life.json` en `/data/life.json` si existe (plugin `build/personalDataPlugin.ts`); si no, 404 → datos de ejemplo. |
| `npm run build` | `tsc --noEmit` + `vite build` → `dist/`. |
| `npm run preview` | Sirve `dist/` en `:4173` (el mismo plugin sirve `./data/life.json`). |
| `npm run lint` / `npm run typecheck` | ESLint (con reglas de arquitectura) / `tsc --noEmit`. |
| `npm run test` / `npm run test:coverage` | Vitest (jsdom). Cobertura v8 con umbral global del 75 %. |
| `npm run validate:data [-- ruta]` | Valida un JSON con el validador del dominio. Sin ruta: `data/life.json` si existe, si no el de ejemplo. Código de salida 1 si hay errores, 2 si no se puede leer. |

Parámetros de URL: `?cat=a,b` (filtro; `?cat=` = ninguna), `?private=1` (muestra eventos privados),
`?example=1` (fuerza los datos de ejemplo aunque haya `life.json`), `?debug=1` (expone
`window.__timelineDebug`), `?nowebgl=1` (fuerza el fallback en lista), `?reduced-motion=1`
(fuerza el modo de movimiento reducido).

## Arquitectura (resumen)

- `src/domain` — puro. `PartialDate` (value object), `LifeEvent`, `Timeline`, `CategorySelection`;
  servicios `LifeDataValidator` (errores acumulados con ruta), `TimelineFactory`, `TimelineLayout`
  (determinista), `EventFilter`, `isHttpUrl`.
- `src/application` — puertos (`TimelineRepository`, `TimelineView`, `FilterStateStore`), casos de
  uso (`LoadTimeline`, `ToggleCategoryFilter`, `SelectEvent`, `NavigateEvents`) y
  `TimelineController`.
- `src/infrastructure` — `http/` (fetch + fallback), `storage/` (filtro en la query string),
  `dom/` (overlay: `Hud`, `FilterBar`, `EventPopup`, `Tooltip`, `EventList`, `NodeLabels`,
  `YearRuler`, `KeyboardShortcuts`, `LiveAnnouncer`, `ViewControls`) y `three/` (escena).
- `src/main.ts` — composition root.

ESLint impide que `domain` y `application` importen `three` o `infrastructure`, o usen
`window`/`document`/`fetch` (`no-restricted-imports` / `no-restricted-globals`).

El puerto `TimelineView` lo implementa `CompositeTimelineView`, que reparte cada llamada entre
"piezas" (`Partial<TimelineView>`): la vista three y cada componente DOM. Añadir una pieza nueva
no obliga a tocar las demás.

**Efectos**: todo lo que se anima en la escena implementa `SceneEffect`
(`attach / update(frame) / dispose`): `Nebula`, `Starfield`, `YearMarkers`, `BranchCurve`,
`ParticleFlow`, `SelectionPulse`. Un efecto nuevo = una clase nueva registrada en `SceneBuilder`.

**Testabilidad**: la lógica está fuera de WebGL. `math.ts` (`PathTable`, `pickNode`, `damp`),
`labelLayout.ts`, `CameraRig` (solo necesita una `PerspectiveCamera`, funciona en jsdom),
`RenderLoop` (planificador y visibilidad inyectables), `PointerInput` (eventos DOM),
`NodeMesh`/`SceneBuilder` (construyen objetos three sin renderer; las texturas son `DataTexture`
procedurales, no necesitan canvas 2D). `ThreeTimelineView` recibe un `RenderBackend`
(`{ renderer, createPostProcessing }`) que en tests puede ser un doble; lo único que exige WebGL
real es `webgl.ts` y `PostFX.ts`.

## Decisiones y desviaciones respecto al contrato

1. **Volumen de Docker**: el contrato monta `./data/life.json` en
   `/usr/share/nginx/html/data/life.json:ro`. Con ese bind, si el fichero no existe Docker crea un
   *directorio* `life.json` en el host y nginx falla. `docker-compose.yml` monta el **directorio**
   `./data` en `/usr/share/nginx/userdata:ro` y nginx resuelve `/data/life.json` con
   `try_files /userdata/life.json /html/data/life.json =404`. Así arranca sin fichero (404 → datos
   de ejemplo) y la ruta literal del contrato sigue funcionando si alguien monta el fichero suelto.
2. **Validación en el repositorio**: `HttpJsonTimelineRepository` recibe el `LifeDataValidator`
   por constructor porque "no valida → fallback" es una decisión de carga. Los errores del JSON
   personal rechazado se escriben con `console.warn`.
3. **Rueda del ratón**: rueda / trackpad = viajar por el tiempo (lo que pide el contrato);
   zoom = `Ctrl`+rueda, pellizco, teclas `+`/`−` o botones. `0` o `◇` = vista general.
4. **Selección en dos niveles**: ←/→ *enfocan* un evento (vuelo de cámara + pulso) y `Enter` abre
   el pop-up; con el pop-up abierto, ←/→ cambian de evento sin cerrarlo. Clic en un nodo abre
   directamente. `Esc` cierra el pop-up y, si no hay, suelta el foco.
5. **"Clic fuera"**: el pop-up es un panel lateral, no hay velo que bloquee la escena. Lo cierran
   un clic en el vacío de la escena o en cualquier zona que no sea escena, filtros, controles o
   índice (`[data-keep-popup]`). Arrastrar la escena no lo cierra.
6. **Rótulos y años en DOM**: los títulos de los nodos y la regla de años son elementos DOM
   colocados con la proyección de la cámara (interfaz `ProjectionListener`), no sprites: tipografía
   nítida y fuera del bloom. Son `aria-hidden`; el contenido accesible está en el índice.
7. **Eventos privados que son origen de rama**: si el `branchFrom` de una rama apunta a un evento
   oculto, la rama nace del tronco a la altura de su primer evento.
8. **Reglas extra del validador** (además de las del contrato): ids en kebab-case, `main` no
   admite `branchFrom`, `branchFrom` no puede apuntar a la propia rama, una rama solo tiene un
   origen y las ramas no pueden formar ciclos.
9. **JSON Schema**: `schema/life.schema.json` describe la forma. Las reglas cruzadas (unicidad,
   referencias, `end >= start`, ciclos) no son expresables en JSON Schema; las cubre
   `npm run validate:data`. El schema no se valida con una librería (no hay `ajv` en el proyecto).
10. **Fuentes autoalojadas** (`@fontsource`): Instrument Serif, Hanken Grotesk e IBM Plex Mono van
    en el bundle para que la CSP sea `font-src 'self'` y no haya llamadas a terceros.
    `build.assetsInlineLimit: 0` evita que Vite incruste subconjuntos pequeños como `data:`.
11. **CSP** (`nginx/security-headers.conf`): `style-src 'self'` sin `unsafe-inline`. Los estilos
    dinámicos (colores de categoría, posiciones) se aplican por CSSOM (`element.style`), que la CSP
    permite; no hay atributos `style` en el HTML. `img-src` admite `https:` para `media`.
12. **Media**: los datos de ejemplo no llevan imágenes para no depender de terceros. El pop-up las
    soporta (`<img loading="lazy" referrerpolicy="no-referrer">`, se retira la figura si falla).

## Seguridad

- Todo el contenido del JSON entra por `textContent` (`dom.ts → el()`); no hay `innerHTML`.
- Enlaces: solo `http(s)` (`isHttpUrl`), `target="_blank" rel="noopener noreferrer"`. Se filtra
  tres veces: validador, `TimelineFactory` y `safeLink()`.
- `data/` está en `.gitignore` y `.dockerignore`.

## Comprobación visual automatizada

`scripts/ui-check.mjs` abre la web en Chrome headless (WebGL por software) y recorre: escena,
hover, clic en nodo → pop-up, navegación, `Esc`, filtro (contador + URL), vista general, índice,
móvil, fallback sin WebGL y movimiento reducido con privados. Guarda capturas numeradas y sale con
código 1 si falla alguna comprobación (incluidos errores de consola, salvo el 404 esperado de
`/data/life.json`).

`puppeteer-core` **no** es dependencia del proyecto; se instala fuera:

```bash
npm i --prefix /tmp/ui-check puppeteer-core
npm run build && npm run preview &          # http://localhost:4173
NODE_PATH=/tmp/ui-check/node_modules node scripts/ui-check.mjs \
  --url http://localhost:4173 --out /tmp/ui-shots --example --settle 14000
```

Opciones: `--url`, `--out`, `--example` (añade `?example=1`), `--event <id>` (nodo que se pulsa),
`--category <id>` (chip que se desactiva), `--settle <ms>` (espera tras cargar; con SwiftShader la
escena va a ~4 fps, así que hacen falta ~14 s para que termine el vuelo de apertura). Variable
`CHROME_BIN` para otra ruta de Chrome.

Gancho de depuración (solo con `?debug=1`):

```js
window.__timelineDebug.ready            // boolean: datos cargados
window.__timelineDebug.webgl            // boolean: escena 3D activa
window.__timelineDebug.nodes()          // [{ id, x, y, visible }] en píxeles CSS de la ventana
window.__timelineDebug.open('id')       // abre el pop-up de un evento
```

## Estado

Bloques del encargo (para reanudar si se corta la sesión):

| Bloque | Estado |
| --- | --- |
| 1. Dominio + aplicación + carga de datos + escena three | Hecho. Compila y se ve. |
| 2. Pop-up y filtros | Hecho (foco, Esc, clic fuera, chips, URL). |
| 3. VFX y pulido | Hecho (bloom, partículas, estrellas, nebulosa, halos, niebla, pulso, rótulos). |
| 4. Docker | Ficheros escritos; `docker build` SIN ejecutar (registro bloqueado, ver abajo). |
| 5. ui-check y capturas | Hecho: `scripts/ui-check.mjs` en verde. |

Resultados de la última pasada (10/11/2026):

- `npm run lint`, `npm run typecheck`, `npm run build`: en verde.
- `npm run test` / `npm run test:coverage`: 758 tests en 43 ficheros, en verde; cobertura global
  99,67 % sentencias · 97,44 % ramas · 100 % funciones · 99,87 % líneas (umbral 75 %). La cadena de
  calidad del contrato (`lint && typecheck && test:coverage && build`) pasa entera. Detalle por
  capa, bugs corregidos y huecos en `docs/QA_REPORT.md`; cómo están organizados los tests, en la
  sección «Tests» de más abajo.
- **`docker build` no se ha podido ejecutar**: la política de red de este entorno deniega (403) los
  registros de imágenes (`registry-1.docker.io`; tampoco `public.ecr.aws`, `mirror.gcr.io`), así
  que `node:22-alpine` y `nginx:alpine` no se descargan. El `Dockerfile` y `docker-compose.yml`
  están sin probar. Lo que sí se probó es `nginx/default.conf` con un nginx local (1.24, instalado
  con apt) reproduciendo las rutas del contenedor: `/` 200, `/data/life.example.json` 200,
  `/healthz` 200, `/data/life.json` 404 sin volumen y 200 con el fichero en `userdata/`; cabeceras
  de seguridad, caché y gzip correctos; y `scripts/ui-check.mjs` en verde contra ese nginx (CSP
  aplicada, sin errores de consola). Pendiente: construir la imagen en CI o en una máquina con
  acceso a Docker Hub.

## Pendiente / limitaciones conocidas

- No hay `.github/workflows/ci.yml` (no estaba en el encargo de este agente).
- No hay enlace profundo a un evento (`?event=id`); solo el filtro vive en la URL.
- Textos de interfaz solo en español (`infrastructure/dom/strings.ts`); `meta.locale` se usa para
  el formato de fechas y el atributo `lang`.
- El ancho de los rótulos de nodo se estima por número de caracteres (no se mide el DOM).
- Las ramas se separan por carriles en Y/Z; con muchas ramas simultáneas (> 4) la escena crece en
  vertical y habría que revisar el encuadre por defecto.
- Rendimiento medido solo con renderizado por software (SwiftShader, ~4 fps a 1440×900); no se ha
  podido medir en GPU real. El coste principal son el bloom y la nebulosa procedural a pantalla
  completa.
- Probado solo en Chrome headless; sin pruebas en Firefox/Safari ni en dispositivos táctiles reales.

## Tests (agente 3)

`tests/` refleja `src/` (`domain/`, `application/`, `infrastructure/{http,storage,dom,three}`), más:

- `tests/data/` — valida `public/data/life.example.json` con el validador del dominio.
- `tests/security/` — inyección de HTML y URLs peligrosas, de punta a punta y capa a capa.
- `tests/integration/` — la app cableada como en `main.ts` pero sin escena 3D (fetch falso →
  repositorio → controlador → DOM y URL).
- `tests/schema/` — coherencia entre `schema/life.schema.json` y el validador (sin `ajv`).
- `tests/scripts/` — `scripts/validate-data.ts` en un proceso aparte (códigos de salida 0/1/2).
- `tests/helpers/` — `fixtures.ts` (datos mínimos válidos, `buildModel`, handlers falsos),
  `fakes.ts` (vista, repositorio y almacén falsos), `dom.ts` (`mount`, `press`, `unsafeModel`),
  `three.ts` (planificador y visibilidad manuales, `frameContext`), `app.ts` (`mountApp`).

Convenciones:

- Nombres de test en español, describiendo el comportamiento. «Hoy» es siempre una fecha inyectada.
- Los tests nunca leen `data/life.json`; usan `makeData()` o el JSON de ejemplo.
- `unsafeModel()` construye un modelo SIN pasar por validador ni fábrica: es la forma de comprobar
  que cada capa se defiende sola de datos hostiles.
- jsdom normaliza `style.transform`; para posiciones usa `translation(element)` en vez de comparar
  la cadena.
- La capa three se prueba sin WebGL: objetos three reales (geometrías, materiales, cámara) y un
  `RenderBackend` falso para `ThreeTimelineView`. Solo `webgl.test.ts` usa `vi.mock` (sustituye
  `WebGLRenderer` y las pasadas de `three/examples/jsm/postprocessing`).
- jsdom no trae `ResizeObserver`: `ThreeTimelineView.test.ts` lo sustituye con `vi.stubGlobal`.
- No hay exclusiones de cobertura nuevas: siguen siendo `main.ts` y los ficheros que solo declaran
  tipos.
