# Informe de coherencia y UI/UX (agentes 5 y 8)

Rama `feature/ux-coherencia`, 11/11/2026. Revisión de contrato ↔ código ↔ tests ↔ README ↔ CI ↔
Docker/nginx/compose ↔ scripts npm, y pulido visual a partir de capturas reales.

## Qué se revisó

- `docs/CONTRACT.md`, `docs/DEV_NOTES.md`, `docs/QA_REPORT.md`, `docs/DOC_DISCREPANCIES.md`, `README.md`.
- `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.public.yml`,
  `package.json` (scripts), `scripts/build-public-data.ts`, `schema/life.schema.json`.
- `scripts/ui-check.mjs` dos veces: con datos de ejemplo (`--example`) y con los datos reales (sin copiar esas
  capturas al repositorio). Comprobación aparte en Chrome headless de los tres arreglos de accesibilidad recientes.
- Privacidad de lo commiteado: `git grep` y `git log -p` de todas las ramas buscando correos, teléfonos, fechas de
  nacimiento y frases de `data/life.json`. Resultado: nada (solo `a@example.com` en un test). En git solo está
  `data/.gitkeep`; nunca se ha commiteado `hr/`. El README solo nombra al autor y su GitHub.

## Qué se cambió

| Área | Cambio |
| --- | --- |
| Accesibilidad | Pop-up como diálogo **no modal**: fuera `aria-modal` y la trampa de Tab (A6). Se elimina `focusableWithin`, que quedaba sin uso |
| Rótulos | Campo opcional `shortTitle` (≤ 40 caracteres) en tipo, validador, factoría, schema, contrato, README, ejemplo y tests; `LifeEvent.labelTitle`. `clampLabelX`: un rótulo junto al borde se desplaza para verse entero; si el nodo está fuera de pantalla no se rotula |
| Ramas | Una rama cerrada (no llega al presente) se disuelve: sus motas frenan, se dispersan, suben y se apagan (`FlowPath.dissolve`). Una rama con eventos anteriores a su origen se separa de la línea madre en su propia X |
| Primer vistazo | La ayuda empieza por «clic en un nodo para abrirlo»; en táctil explica los gestos y se muestra en móvil encima de los filtros. Halo oscuro en el texto de la cabecera en móvil |
| Coherencia | README: CI real (jobs, prueba de humo, `main` solo por PR), `build:public-data`, `docker-compose.public.yml`, tabla de scripts y de ficheros de datos, avisos de Docker. Contrato: scripts, volumen real, despliegue público, pasos de CI. Schema: URL sin distinguir mayúsculas, `branchFrom` kebab-case. Textos «Cuándo/Dónde/Con/hoy» a `STRINGS`. Comentario de `Tooltip` |
| Tests | `tests/scripts/build-public-data.test.ts` (`toPublicData` y el script en proceso aparte); tests nuevos de `shortTitle`, `clampLabelX`, rama anterior a su origen, disolución de partículas y pop-up no modal. 776 tests en 44 ficheros; cobertura 99,78 % sentencias · 97,59 % ramas · 100 % funciones · 100 % líneas |
| Capturas | `docs/img/01-escena.png` y `docs/img/08-movil.png` regeneradas con datos de ejemplo |

Estado de cada discrepancia: [`DOC_DISCREPANCIES.md`](DOC_DISCREPANCIES.md).

## Qué queda abierto

- **C8** niebla y fondo fijos en `ThreeTimelineView` (la opción `fogDensity` no los cambia).
- **C9** `particleBudget` no se recalcula al cambiar la preferencia de movimiento o el tamaño de ventana.
- **C10** textos de `index.html` fuera de `STRINGS` (i18n futura).
- Móvil: en el encuadre inicial una rama puede pasar por detrás de los enlaces de la cabecera; el halo mejora
  la lectura, pero un encuadre que reserve la zona de la cabecera sería la solución de fondo.
- El año de un rótulo colocado encima de su nodo puede quedar sobre el filamento de la rama (legible, pero
  mejorable con un fondo sutil).
- `ui-check` con datos reales necesita `--category` con eventos exclusivos (ver DEV_NOTES).
- `docs/QA_REPORT.md` conserva las cifras de su pasada (758 tests); las actuales están arriba.
