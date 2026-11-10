# Discrepancias contrato ↔ código (agente 7, documentación)

Detectadas al documentar el proyecto el 10/11/2026 leyendo `docs/CONTRACT.md`, `docs/DEV_NOTES.md` y el código.
El `README.md` describe siempre lo que hace el código. Aquí se listan las diferencias para el agente de coherencia.

Gravedad: **A** = conviene decidir o corregir · **B** = desviación consciente, ya razonada en DEV_NOTES · **C** = detalle menor.

## A. Requieren decisión o corrección

| # | Tema | Contrato | Código | Nota |
| --- | --- | --- | --- | --- |
| A1 | CI | Exige `.github/workflows/ci.yml` (lint, typecheck, test con cobertura, build, `docker build`) | No existe el directorio `.github/` | El README documenta el flujo como definido en el contrato y avisa de que el fichero no está. Si otro agente lo añade, hay que quitar ese aviso (secciones 5.12 y 10 del README) |
| A2 | Eventos privados | «`private` se oculta salvo `?private=1`» | El filtrado ocurre en el cliente (`TimelineFactory`). `life.json` se sirve entero y `?private=1` lo puede poner cualquiera | No es un control de acceso. El contrato no lo aclara y puede dar una falsa sensación de privacidad. El README lo avisa de forma explícita (3.8, 8 y 10) |
| A3 | `hr/` en el contexto de Docker | «Datos personales nunca dentro de la imagen» | `.dockerignore` excluye `data/` y `public/data/life.json`, pero **no** `hr/`. `COPY . .` lo copia a la etapa de build | No llega a la imagen final (solo se copia `dist/`), pero queda en las capas y la caché de la etapa de build. `hr/` sí está en `.gitignore`. Sugerencia: añadir `hr` a `.dockerignore` |
| A4 | Cadena de calidad | `lint && typecheck && test:coverage && build` debe pasar en limpio | Según DEV_NOTES, `test:coverage` no alcanzaba el umbral (solo había tests de humo en `tests/domain/smoke.test.ts`) | Depende del trabajo del agente de tests. El README no da cifras y remite a `docs/QA_REPORT.md` |
| A5 | `docker build` | Imagen multi-stage funcional | `Dockerfile` y `docker-compose.yml` escritos pero sin ejecutar (registros bloqueados en el entorno) | Documentado como limitación. Pendiente de verificar en CI o en otra máquina |
| A6 | `aria-modal` | Pop-up con `role="dialog"`, `aria-modal` | Se declara `aria-modal="true"`, pero el pop-up es un panel lateral sin velo: escena, filtros, controles e índice siguen operables con el puntero. El foco de teclado sí queda atrapado | Incoherencia semántica de accesibilidad. O se quita `aria-modal`, o se hace inerte el resto mientras está abierto |

## B. Desviaciones conscientes (documentadas en DEV_NOTES)

| # | Tema | Contrato | Código |
| --- | --- | --- | --- |
| B1 | Volumen de Docker | Monta `./data/life.json` en `/usr/share/nginx/html/data/life.json:ro` | Monta el directorio `./data` en `/usr/share/nginx/userdata:ro`; nginx resuelve con `try_files /userdata/life.json /html/data/life.json =404`. La ruta literal del contrato sigue funcionando si se monta el fichero suelto |
| B2 | `.gitignore` | Ignora `/data/life.json` y `/public/data/life.json` | Ignora `/data/*` (salvo `.gitkeep`), `/public/data/life.json` y además `/hr/`. Más amplio que el contrato |
| B3 | Reglas de validación | ids únicos, categorías existentes, `branchFrom` existe, fechas válidas, `end >= start`, color hex, URLs http(s) | Además: ids y `branch` en kebab-case; `main` no admite `branchFrom`; `branchFrom` no puede apuntar al propio evento ni a la misma rama; un único origen por rama; sin ciclos entre ramas; año ≥ 1000; día real del mes; `media.type` solo `image` y `alt` obligatorio; al menos una categoría definida |
| B4 | Zoom y rueda | «arrastrar/scroll para recorrer el tiempo, zoom» | Rueda = viajar; zoom con `Ctrl`/`Cmd`+rueda, pellizco, teclas `+`/`-` o botones; `0` = vista general |
| B5 | Selección | «clic/Enter → pop-up» | Dos niveles: ←/→ enfocan (vuelo + pulso), `Enter`/`Espacio` abren. Con el pop-up abierto, ←/→ cambian de evento sin cerrarlo |
| B6 | «Clic fuera» | Cierra el pop-up | Lo cierra un clic en el vacío de la escena o en cualquier zona sin `[data-keep-popup]`. Clic en filtros, controles o índice no lo cierra; arrastrar tampoco |
| B7 | Marcas de año y rótulos | «Marcas de año sobre el eje» | Meridianos en la escena (`YearMarkers`) más regla y rótulos en DOM (`YearRuler`, `NodeLabels`) colocados por proyección |
| B8 | Validación en el repositorio | El contrato no dice dónde se valida | `HttpJsonTimelineRepository` recibe el validador de dominio por constructor |

## C. Detalles menores

| # | Tema | Contrato | Código |
| --- | --- | --- | --- |
| C1 | Causas del fallback | «si responde 404 o no valida» | También cae al ejemplo con cualquier estado HTTP no 2xx, error de red o JSON mal formado |
| C2 | Parámetros de URL | Solo menciona `?private=1` y el filtro en la URL | Existen además `?example=1`, `?debug=1`, `?nowebgl=1`, `?reduced-motion=1`. Los indicadores se activan con cualquier valor distinto de `0` o `false` (también `?private` sin valor) |
| C3 | Salida de `TimelineLayout` | `{ nodes: {eventId, position, branch}, branches: {id, points[]} }` | Añade `years`, `bounds`, `nowX`; en nodos `span`; en ramas `originEventId`, `lane`, `open` |
| C4 | Árbol de `src/` | Lista un subconjunto de clases | Existen además `CategorySelection`, `TimelineFactory`, `safeUrl`, `CompositeTimelineView`, `EventList`, `NodeLabels`, `YearRuler`, `KeyboardShortcuts`, `LiveAnnouncer`, `ViewControls`, `labelLayout`, `Nebula`, `YearMarkers`, `SelectionPulse`, `PointerInput`, `RenderLoop`, `webgl`, `math`, `textures` |
| C5 | Fallback sin WebGL | «si no hay WebGL» | Se exige **WebGL2** (`getContext('webgl2')`): un dispositivo solo con WebGL1 va al modo lista |
| C6 | Tooltip | «título + fechas» | Muestra categoría principal, título y fechas. El comentario de la clase `Tooltip` dice «+ resumen corto», pero el resumen no se pinta |
| C7 | JSON Schema «equivalente» | `schema/life.schema.json` equivalente al tipo | Describe la forma, pero es más laxo que el validador: admite días imposibles (`2023-02-31`), años < 1000 y `branchFrom` sin formato; su patrón de URL distingue mayúsculas (`^https?://`) y el validador no. Nada en el proyecto valida contra el schema |
| C8 | `SceneBuildOptions.fogDensity` | — | La opción se aplica a los materiales de las ramas, pero la niebla de la escena se crea en `ThreeTimelineView.render` con `0.0068` y `DEFAULT_PALETTE.background` fijos: cambiar la opción o la paleta en `SceneBuilder` no cambia la niebla ni el fondo |
| C9 | Presupuesto de partículas | «`prefers-reduced-motion` reduce partículas» | `particleBudget` se evalúa una vez en `main.ts`; un cambio posterior de la preferencia o del ancho de ventana no lo recalcula (el resto del modo reducido sí reacciona en vivo) |
| C10 | Textos de interfaz | — | No todos están en `strings.ts`: «Cuándo», «Dónde», «Con» (`EventPopup`), «hoy» (`YearRuler`) y los de `index.html` están escritos en el sitio. Relevante para la i18n futura |
| C11 | «Añadir un efecto sin modificar» | «nuevos efectos = nuevas clases que implementan `SceneEffect`» | Cierto para la vista, pero hay que registrar la clase en la lista `effects` de `SceneBuilder.build()`; no hay registro externo |
| C12 | Cabeceras de seguridad en desarrollo | — | CSP y demás cabeceras solo las pone nginx; `npm run dev` y `npm run preview` no las aplican, así que un fallo de CSP solo se ve tras desplegar o con `ui-check` contra nginx |

## Notas para quien mantenga el README

- El README no incluye cifras de cobertura ni resultados de comprobaciones: remite a `docs/QA_REPORT.md`, que en el momento de escribirlo aún no existía.
- Si se resuelve A1 o A5, actualizar los avisos de las secciones 2, 5.12 y 10 del README.
- Capturas en `docs/img/` copiadas de `/tmp/ui-shots` (datos de ejemplo, persona ficticia).
