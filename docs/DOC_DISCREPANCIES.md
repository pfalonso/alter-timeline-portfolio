# Discrepancias contrato ↔ código

Detectadas por el agente 7 (documentación) el 10/11/2026. Revisadas y cerradas, cuando se ha podido, por el
agente 8 (coherencia) el 11/11/2026 en la rama `feature/ux-coherencia`; el detalle está en
[`COHERENCE_REPORT.md`](COHERENCE_REPORT.md). El `README.md` describe siempre lo que hace el código.

Gravedad: **A** = conviene decidir o corregir · **B** = desviación consciente, razonada en DEV_NOTES · **C** = detalle menor.

Estado: **resuelta** (código o documentación corregidos) · **aceptada** (se mantiene, con el motivo) · **abierta**.

## A. Requerían decisión o corrección

| # | Tema | Estado | Resolución |
| --- | --- | --- | --- |
| A1 | CI | Resuelta | `.github/workflows/ci.yml` existe (jobs `quality` y `docker`) y está en verde en GitHub. README (2, 5.12, 10) y contrato actualizados |
| A2 | Eventos privados | Resuelta | Sigue siendo un filtro de cliente (no es control de acceso) y así lo dicen README 3.8/8 y el contrato. Para despliegues públicos existe `npm run build:public-data` (genera `data/public/life.json` sin privados) y `docker-compose.public.yml`; ambos documentados y con tests (`tests/scripts/build-public-data.test.ts`) |
| A3 | `hr/` en el contexto de Docker | Resuelta | `.dockerignore` excluye `hr/` |
| A4 | Cadena de calidad | Resuelta | `lint && typecheck && test:coverage && build` en verde; cobertura ~99 % (umbral 75 %) |
| A5 | `docker build` | Resuelta | Se construye en la CI, con prueba de humo (`/healthz`, `/`, ejemplo 200 y `/data/life.json` 404). En el entorno de desarrollo sigue sin poder ejecutarse (registros bloqueados) |
| A6 | `aria-modal` | Resuelta | El pop-up pasa a ser un diálogo **no modal**: sin `aria-modal` y sin trampa de Tab. Se eligió esta opción y no `inert` porque el diseño exige que escena, filtros, índice y ←/→ sigan operables con el panel abierto (B5, B6); hacerlo modal habría roto ese comportamiento. Contrato, README y tests actualizados |

## B. Desviaciones conscientes

Todas **aceptadas**: están razonadas en `docs/DEV_NOTES.md` y descritas en el README.

| # | Tema | Contrato | Código |
| --- | --- | --- | --- |
| B1 | Volumen de Docker | Monta `./data/life.json` en `/usr/share/nginx/html/data/life.json:ro` | Monta el directorio `./data` en `/usr/share/nginx/userdata:ro`; nginx resuelve con `try_files`. El contrato ya lo menciona |
| B2 | `.gitignore` | Ignora `/data/life.json` y `/public/data/life.json` | Ignora `/data/*` (salvo `.gitkeep`), `/public/data/life.json` y `/hr/`. Más amplio que el contrato |
| B3 | Reglas de validación | Lista básica | Además: kebab-case, `main` sin `branchFrom`, un origen por rama, sin ciclos, año ≥ 1000, día real del mes, `media` solo `image` con `alt`, al menos una categoría, `shortTitle` ≤ 40 caracteres |
| B4 | Zoom y rueda | «arrastrar/scroll para recorrer el tiempo, zoom» | Rueda = viajar; zoom con `Ctrl`/`Cmd`+rueda, pellizco, `+`/`-` o botones; `0` = vista general |
| B5 | Selección | «clic/Enter → pop-up» | ←/→ enfocan, `Enter`/`Espacio` abren; con el pop-up abierto, ←/→ cambian de evento |
| B6 | «Clic fuera» | Cierra el pop-up | Lo cierra un clic en el vacío de la escena o fuera de `[data-keep-popup]`; arrastrar no |
| B7 | Marcas de año y rótulos | «Marcas de año sobre el eje» | Meridianos en la escena más regla y rótulos en DOM |
| B8 | Validación en el repositorio | No dice dónde | `HttpJsonTimelineRepository` recibe el validador por constructor |

## C. Detalles menores

| # | Tema | Estado | Nota |
| --- | --- | --- | --- |
| C1 | Causas del fallback | Aceptada | También cae al ejemplo con cualquier estado no 2xx, error de red o JSON mal formado. Es más robusto; README 3.3 lo documenta |
| C2 | Parámetros de URL | Aceptada | `?example`, `?debug`, `?nowebgl`, `?reduced-motion` son herramientas de desarrollo y prueba; documentados en README 4.5 y DEV_NOTES |
| C3 | Salida de `TimelineLayout` | Aceptada | Añade `years`, `bounds`, `nowX`, `span`, `originEventId`, `lane`, `open`: superconjunto del contrato |
| C4 | Árbol de `src/` | Aceptada | El contrato lista un subconjunto; el árbol completo está en README 5 |
| C5 | Fallback sin WebGL | Aceptada | Se exige WebGL2; documentado en README 2 |
| C6 | Tooltip | Resuelta | El comentario de `Tooltip` ya no promete el resumen: categoría + título completo + fechas |
| C7 | JSON Schema «equivalente» | Resuelta en parte | El patrón de URL ya no distingue mayúsculas (como el validador), `branchFrom` usa el formato kebab-case y `shortTitle` lleva `minLength`/`maxLength`. **Aceptado**: días imposibles y años < 1000 siguen siendo cosa del validador (un patrón no los expresa de forma legible); nada valida contra el schema (sin `ajv`) |
| C8 | `SceneBuildOptions.fogDensity` | Abierta | La niebla de la escena y el fondo siguen fijos en `ThreeTimelineView.render`. Sin efecto visible hoy; corregir si se añade un tema de color |
| C9 | Presupuesto de partículas | Abierta | `particleBudget` se calcula al cargar. Documentado como limitación en README 10 |
| C10 | Textos de interfaz | Resuelta en parte | «Cuándo», «Dónde», «Con» y «hoy» pasan a `STRINGS`. Quedan los textos de `index.html` (README 6.5) |
| C11 | «Añadir un efecto sin modificar» | Aceptada | Hay que registrar la clase en `SceneBuilder.build()`; README 6.2 lo explica |
| C12 | Cabeceras de seguridad en desarrollo | Aceptada | Solo nginx aplica la CSP; `ui-check` se puede lanzar contra nginx (DEV_NOTES) |
