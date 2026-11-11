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
| `npm run build:public-data [-- origen destino]` | `data/life.json` → `data/public/life.json` sin eventos privados (reengancha `branchFrom` al ancestro público). Se despliega con `docker-compose.public.yml`. |

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
5. **"Clic fuera"**: el pop-up es un panel lateral, no hay velo que bloquee la escena. Por eso es
   un diálogo **no modal** (sin `aria-modal` ni trampa de Tab; ver DOC_DISCREPANCIES A6). Lo cierran
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

13. **Carriles compactos** (`TimelineLayout.assignLanes`, 11/11/2026). Con los datos reales (45
    eventos, 10 ramas, hasta 8 simultáneas) el reparto alterno +1/−1/+2… llevaba ramas hijas al
    lado contrario de su madre (cruces de 30 unidades) y la separación fija (4,6) daba ±18 de alto.
    Ahora es un *interval scheduling*: por orden de nacimiento, cada rama toma el carril libre de
    menor coste = |carril − carril madre| + 1,5 si cruza el tronco; a igual coste, el más cercano al
    tronco y, para hijas del tronco, el lado con menos carriles ocupados en ese momento. Un carril se
    libera `0,8` años después del final de su rama. La separación efectiva es
    `clamp(maxLaneSpread / carril_más_alejado, minLaneSpacing, laneSpacing)` = `[2,6, 4,6]`, y la
    profundidad Z se escala igual; el resultado expone `laneSpacing`. Con ≤ 2 carriles por lado (el
    ejemplo) no cambia nada. Datos reales: ±10,7 en vez de ±18,7. No se acortaron las curvas de
    salida (`blendYears`): con carriles contiguos el salto ya es corto.
14. **Encuadre con franjas reservadas** (`ThreeTimelineView`). `main.ts` mide `safeInsets`
    (arriba: controles, y la cabecera solo si ocupa ≥ 60 % del ancho, como en móvil; abajo: borde
    superior de los filtros, y la ayuda si es ancha). La apertura calcula la extensión vertical de
    las ramas visibles cerca de hoy (`verticalExtent`) y se aleja lo justo (tope 80) para que quepan
    en la franja libre, centradas en ella (`bandFraction`/`bandOffset`, franja mínima 35 %). La
    vista general ajusta ancho **y** alto (tope 105) y los límites Y de la cámara admiten ese
    desplazamiento. En escritorio la cabecera no reserva franja (ocupa solo la izquierda): las ramas
    antiguas pasan por detrás de ella, como antes. Los rótulos esquivan también controles y regla.

15. **Líneas vitales** (`branches[]`, `meta.mainBranch`, 11/11/2026). Modelo nuevo encima del
    antiguo, sin romperlo: los eventos sin `branch` van a la línea central (`mainBranch`, `main` por
    defecto) y `Timeline.originOf` usa `origin` si es visible y, si no, el `branchFrom` de siempre.
    Decisiones: un periodo de `focus` sin `end` sigue hasta hoy (como `"present"`); la central no
    admite `origin` ni `mergeInto`; las líneas declaradas sin eventos dan error salvo la central;
    `mainBranch` es obligatorio solo si hay `branches` y ningún evento usa `"main"` (los datos
    antiguos no cambian). Una fusión cuyo evento está oculto o es anterior al nacimiento de la línea
    se ignora (la línea se cierra como una rama normal). En `branchIds` van la central, después las
    declaradas en su orden y luego el resto: el orden de declaración desempata los carriles de las
    líneas que nacen a la vez.
16. **Foco en la escena.** El dominio calcula la intensidad por punto (`LayoutBranch.focus`, con
    `focusIntensityAt`); `BranchCurve` la convierte en atributos por vértice del tubo (`aFocus` y
    `aWidth`, leídos en la X de cada anillo) y `ParticleFlow` en una tabla uniforme en t
    (`sampleAlongPath`): fuera de foco hay menos motas visibles (umbral `rank` por mota), van más
    despacio y brillan menos. Las líneas con `origin` declarado se abren en `bundleBlendYears` (2,6)
    en vez de `blendYears` (1,1), y las fusiones convergen en `mergeBlendYears` (2,2). La costura es
    un efecto propio (`MergeSeam`). Resaltado desde la leyenda: `ThreeTimelineView.highlightBranch`
    → `BuiltScene.highlightBranch` (realce suave; inmediato con movimiento reducido).
17. **Vista general de vidas largas.** Con un nacimiento en 1993 la escena mide ~175 unidades: la
    vista general sube su tope de 105 a 160 (y el zoom máximo del `CameraRig` de 110 a 165), con
    margen de ancho 1,1 (antes 1,04: la guiñada de la cámara recortaba el extremo izquierdo). Para
    que lo lejano no se apague, la niebla se aclara en proporción más allá de 90 unidades de
    distancia (`FrameContext.fogDensity`, que `BranchCurve` aplica a su uniforme).
18. **Leyenda** (`LineLegend`): va dentro de `#filters` (encima de los chips, que ahora viven en
    `#filter-bar`), así que las franjas reservadas del encuadre y los rótulos la tienen en cuenta
    sin cambios. Solo aparece si los datos declaran `branches`. En móvil se pliega; desplegada,
    oculta la ayuda de gestos, que ocuparía el mismo sitio.

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
`--category <id>` (chip que se desactiva; un evento sigue visible mientras tenga alguna categoría
activa, así que con datos reales hay que elegir una categoría con eventos exclusivos —p. ej.
`profesional`— o la comprobación del contador falla aunque el filtro funcione), `--settle <ms>` (espera tras cargar; con SwiftShader la
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
| 2. Pop-up y filtros | Hecho (foco, Esc, clic fuera, chips, URL). Pop-up no modal desde el 11/11. |
| 3. VFX y pulido | Hecho (bloom, partículas, estrellas, nebulosa, halos, niebla, pulso, rótulos, ramas cerradas que se disuelven en partículas). |
| 4. Docker | Hecho: `docker build` + prueba de humo en la CI (`.github/workflows/ci.yml`). En este entorno no se puede construir (registros bloqueados). |
| 5. ui-check y capturas | Hecho: `scripts/ui-check.mjs` en verde con datos de ejemplo y con datos reales. |
| 6. Tests (agente 3) | Hecho: ver `docs/QA_REPORT.md`. |
| 7. UI/UX y coherencia (agentes 5 y 8) | Hecho en `feature/ux-coherencia` (11/11/2026): ver `docs/COHERENCE_REPORT.md`. |

Última pasada (11/11/2026, rama `feature/ux-coherencia`):

- `npm run lint && npm run typecheck && npm run test:coverage && npm run build`: en verde.
  Cifras de tests y cobertura en `docs/COHERENCE_REPORT.md`.
- `scripts/ui-check.mjs`: «Todo correcto» con `--example` y con los datos reales
  (`--event concurso-houdini-rbd --category profesional`).
- Comprobado en Chrome headless: el enlace de salto abre el índice y enfoca el primer evento;
  `Ctrl`+`+` no hace zoom en la escena; el pop-up recibe el foco al abrir y no lo roba al cerrar si
  el usuario ya lo movió a un chip.
- CI de GitHub en verde (jobs `quality` y `docker`); `main` solo recibe cambios por PR desde `develop`.

Pasada de layout (11/11/2026, rama `feature/layout-carriles`): carriles compactos y encuadre con
franjas reservadas (decisiones 13 y 14). Cadena de calidad en verde; capturas revisadas con datos
reales (1600×900 y 390×844) y con el ejemplo.

Pasada de líneas vitales (11/11/2026, rama `feature/lineas-vitales`): esquema `branches[]` y
`meta.mainBranch`, foco, fusión, `until`, leyenda (decisiones 15–18). Cadena de calidad en verde;
capturas con el ejemplo (apertura, vista general, hover en la leyenda, móvil y leyenda desplegada).

## Pendiente / limitaciones conocidas

- No hay enlace profundo a un evento (`?event=id`); solo el filtro vive en la URL.
- Textos de interfaz solo en español (`infrastructure/dom/strings.ts`); `meta.locale` se usa para
  el formato de fechas y el atributo `lang`.
- El ancho de los rótulos de nodo se estima por número de caracteres (no se mide el DOM). Para
  títulos largos existe `shortTitle`; un rótulo junto al borde se desplaza para verse entero.
- Con más de ~8 ramas simultáneas la separación queda en su mínimo (`minLaneSpacing`) y la escena
  vuelve a crecer en vertical (el encuadre se aleja para que quepa). Los rótulos esquivan nodos e
  interfaz, pero no los filamentos: alguno puede quedar sobre una rama.
- Rendimiento medido solo con renderizado por software (SwiftShader, ~4 fps a 1440×900); no se ha
  podido medir en GPU real. El coste principal son el bloom y la nebulosa procedural a pantalla
  completa.
- Probado solo en Chrome headless; sin pruebas en Firefox/Safari ni en dispositivos táctiles reales.
- La leyenda solo resalta líneas en la escena 3D; sin WebGL no se muestra. Los rótulos de nodos no
  conocen el foco: un evento de una línea fuera de foco se rotula igual que uno en foco.
- En pantallas táctiles el resaltado de la leyenda depende de `pointerenter` (que en táctil llega con
  el toque): el clic fija/suelta la línea, que es lo que funciona igual en todos los dispositivos.

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
