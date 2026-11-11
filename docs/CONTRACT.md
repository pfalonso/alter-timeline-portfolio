# Contrato del proyecto (fuente de verdad para todos los agentes)

Proyecto: **alter-timeline-portfolio** — portfolio/CV interactivo de Pablo Fernández Alonso
(desarrollador multidisciplinar y tech artist, Donostia). La vida se muestra como una
línea temporal 3D con nodos. Concepto (desde el 11/11/2026): **«mis flores nacieron conmigo, solo he
cambiado el foco»**: las ramas son **líneas vitales** que nacen todas en el nacimiento y discurren en
paralelo; lo que cambia con el tiempo es el **foco** (qué línea brilla), y dos líneas pueden
**fusionarse**. El modelo antiguo (cada bifurcación abre una rama, `branch` + `branchFrom`) sigue
siendo válido.
Diseño visual ORIGINAL (no copiar arte, logos, nombres ni UI de ningún videojuego):
desde el 11/11/2026, **acuarela en movimiento** (nada espacial): papel índigo/ciruela muy oscuro con
lavados de pigmento de los colores de las líneas, líneas como tinta luminosa, motas de pigmento,
bloom contenido. Los nodos se leen como una sola historia en una **banda central**; las líneas entran
y salen de ella como hebras, y las hebras causales (`ledTo`) unen lo que llevó a qué.

## Stack

- Vite + TypeScript (strict) + three.js (postprocesado: EffectComposer + UnrealBloomPass).
- Sin framework de UI: DOM nativo para overlay (filtros, pop-up, HUD).
- Tests: Vitest + @vitest/coverage-v8, entorno jsdom. Umbral global ≥ 75 % (lines, functions, branches, statements).
- Lint: ESLint + typescript-eslint. `npm run typecheck` = `tsc --noEmit`.
- Docker: multi-stage (node:22-alpine build → nginx:alpine). `docker-compose.yml` expone `8080:80`
  y monta `./data/life.json` en `/usr/share/nginx/html/data/life.json:ro` (implementado montando el directorio
  `./data` en `/usr/share/nginx/userdata:ro`; ver DEV_NOTES, decisión 1). `docker-compose.public.yml` (override)
  monta `./data/public` en su lugar para un despliegue público.
- Scripts npm: `dev`, `build`, `preview`, `test`, `test:coverage`, `lint`, `typecheck`, `validate:data`, `build:public-data`.

## Datos (privacidad)

- `public/data/life.example.json` — datos FICTICIOS, sí se commitea.
- `data/life.json` — datos REALES de Pablo. **Nunca en git** (`/data/life.json` y `/public/data/life.json` en `.gitignore`,
  y `data/` en `.dockerignore` para que no entre en la imagen; se monta como volumen).
- En runtime el cliente hace `GET /data/life.json`; si responde 404 o no valida, cae a `GET /data/life.example.json`
  y muestra un aviso discreto "datos de ejemplo".
- En `npm run dev`, un plugin de Vite sirve `data/life.json` en `/data/life.json` si existe.
- `schema/life.schema.json` — JSON Schema (draft 2020-12) equivalente al tipo de abajo.
- `npm run validate:data [ruta]` valida un JSON con el mismo validador del dominio.
- `visibility: "private"` **no es un control de acceso**: el filtrado es en el cliente y el JSON se sirve entero.
  Para un servidor público, `npm run build:public-data [origen] [destino]` genera `data/public/life.json` sin
  eventos privados (reengancha `branchFrom` al ancestro público más cercano y valida el resultado), y se despliega
  con `docker compose -f docker-compose.yml -f docker-compose.public.yml up -d`.

### Esquema `LifeData`

```ts
interface LifeData {
  schemaVersion: 1;
  meta: {
    owner: string;            // "Pablo Fernández Alonso"
    title: string;            // titular del sitio
    tagline?: string;
    locale: string;           // "es" | "en" ...
    contact?: { label: string; url: string }[];
    mainBranch?: string;      // línea central (carril y = 0); por defecto "main"
  };
  categories: Category[];     // N categorías, definidas en datos, no en código
  events: LifeEvent[];
  branches?: BranchInfo[];    // líneas vitales (opcional)
  arcs?: Arc[];               // capítulos contiguos sin solape (opcional)
  story?: { title?: string; path: string[] }; // recorrido del modo historia (opcional)
}
interface Arc {
  id: string;                 // kebab-case único
  title: string;
  subtitle?: string;
  start: string;              // fecha
  end: string | "present";    // fin incluido; "present" solo en el último
  summary?: string;
}
interface BranchInfo {
  id: string;                 // kebab-case único; debe usarse en algún event.branch (o ser mainBranch)
  label: string;              // nombre visible de la línea (leyenda, pop-up, índice)
  color?: string;             // #RRGGBB; si falta, color de la categoría principal del primer evento
  description?: string;
  origin?: string;            // id de evento donde nace la línea; prevalece sobre event.branchFrom
  mergeInto?: { branch: string; event: string }; // converge en `branch` en la posición de `event` (de `branch`) y termina
  until?: "present";          // sigue viva hasta hoy aunque su último evento haya terminado
  focus?: { start: string; end?: string | "present"; level?: 1 | 2 | 3 }[]; // sin end = hasta hoy; level por defecto 3
  style?: "geometric" | "organic" | "neutral"; // forma de sus nodos; por defecto según id (ver abajo)
}
interface Category {
  id: string;                 // kebab-case, único
  label: string;
  color: string;              // hex #RRGGBB
  icon?: string;              // emoji o carácter opcional
  description?: string;
}
interface LifeEvent {
  id: string;                 // kebab-case, único
  title: string;
  shortTitle?: string;        // rótulo corto en la escena (máx. 40 caracteres); si falta, title
  subtitle?: string;          // p. ej. puesto · empresa
  date: { start: string; end?: string }; // "YYYY", "YYYY-MM" o "YYYY-MM-DD"; end puede ser "present"
  categories: string[];       // ≥1 id de categoría; la primera es la principal (color del nodo)
  summary: string;            // 1–2 frases (tooltip y cabecera del pop-up)
  description?: string;       // texto largo; párrafos separados por "\n\n"; se renderiza como TEXTO (sin HTML)
  location?: string;
  organization?: string;
  skills?: string[];
  highlights?: string[];      // logros en viñetas
  links?: { label: string; url: string }[];   // solo http(s)
  media?: { type: "image"; url: string; alt: string }[];
  importance?: 1 | 2 | 3;     // jerarquía: 1 menor, 2 medio (por defecto), 3 mayor
  branch?: string;            // id de rama; por defecto la central (meta.mainBranch, "main")
  branchFrom?: string;        // id del evento del que nace esta rama (bifurcación)
  visibility?: "public" | "private"; // "private" se oculta salvo ?private=1
  bridge?: string;            // ≤ 160: frase que conecta con el evento anterior del recorrido
  ledTo?: string[];           // enlaces causales: ids de eventos posteriores o de la misma fecha (cualquier línea)
}
```

Reglas de validación (dominio): ids únicos; categorías referenciadas existen; `branchFrom` existe;
fechas con formato válido y `end >= start`; color hex válido; URLs http(s). Líneas: ids únicos y usados
por algún evento (o `mainBranch`); `origin` y `mergeInto.event` existen; `mergeInto.branch` existe, es
distinta y contiene `mergeInto.event`; sin ciclos de fusión ni de nacimiento; `focus` con fechas válidas,
`end >= start` y `level` 1–3; `arcs` con ids únicos, fechas válidas, `end >= start` y sin solapes;
`story.path` con ids existentes, sin repetir y en orden cronológico; `bridge` no vacío y ≤ 160;
`ledTo` con ids existentes, sin el propio evento, sin duplicados y con destino no anterior al origen;
`branches[].style` ∈ geometric | organic | neutral;
`mainBranch` con eventos (obligatorio si hay `branches` y nadie usa
`"main"`); `until` solo `"present"` y nunca con `mergeInto`; la central no admite `origin` ni `mergeInto`.
Errores acumulados con ruta (`events[3].date.start: ...`, `branches[1].mergeInto.event: ...`), no solo el primero.

Jerarquía, arcos e historia: `importance` 3 = glifo compuesto grande (forma + anillo/marco exterior +
marca interior + aura de pigmento) y rótulo siempre; 2 = forma sola con contorno y relleno suave,
rótulo al acercarse si cabe; 1 = marca pequeña sin aura ni rótulo salvo hover/foco/selección (se
distinguen también en escala de grises). Forma por línea (`style`, por defecto `tecnologia`/`gestion` →
geometric; `arte`/`gastronomia`/`rol` → organic; resto → neutral): geometric = rombo, hexágono, marco
con esquinas y trazos de circuito; organic = mancha de acuarela, pétalo/gota, pincel, espiral; neutral =
círculo y anillos. Glifos SDF en shader; hover/selección expanden el pigmento. Chips y leyenda usan
el mismo lenguaje.
Banda narrativa: todos los nodos en una banda central (|y| pequeño, desfase por carril, apilado si
coinciden en fecha); las líneas salen de la banda entre nodos hacia su carril y vuelven a cada uno de
sus eventos. Rótulos alternando arriba/abajo de la banda. `ledTo` = hebra de tinta del nodo origen al
destino (degradado de color entre las dos líneas; remolino de pigmento si cambian de línea); pop-up con
«Viene de…» y «Esto llevó a…»; en la historia, si el paso siguiente es consecuencia del actual, la
cámara sigue la hebra. Los
rótulos se colocan por prioridad (fijado > mayor > medio > menor) y nunca se solapan. Los arcos son
separadores verticales etéreos + velo del arco activo en la escena, franja de capítulos sobre la regla
(se ilumina el de la cámara) y grupos en el índice. Modo historia («Ver la historia», tecla H): recorre
`story.path` (limitado a lo visible) con vuelos que siguen las líneas (cortes con movimiento reducido),
pop-up con progreso «3 / 22», arco y `bridge`, Anterior/Siguiente y ←/→ por el recorrido, tarjeta de
capítulo al entrar en un arco nuevo; sale con Esc o botón. Sin `story.path` no hay botón. En modo
libre, ←/→ saltan a importancia ≥ 2 y Mayús+←/→ nodo a nodo. `build:public-data` quita del recorrido
los ids privados y conserva los arcos; también quita de `ledTo` los destinos privados.

Comportamiento visual de las líneas: la central siempre en el carril y = 0, la más brillante y algo más gruesa
hoy; las que comparten `origin` salen del mismo punto como un haz; la intensidad (brillo/bloom, densidad
y velocidad de partículas, opacidad) de cada tramo sale de `focusIntensityAt(line, fecha)` (dominio,
pura: ≈ 0,3 fuera de foco, 0,55/0,78/1 según `level`, rampas suaves); `mergeInto` curva la línea hasta
la destino y pone una costura de partículas; `until: "present"` llega a hoy atenuada; el resto se
disuelve como las ramas cerradas. Leyenda DOM accesible encima de los filtros (plegable en móvil) que
resalta la línea en la escena al pasar el ratón.

## Arquitectura hexagonal

```
src/
  domain/            # puro, sin three ni DOM ni fetch
    model/           # LifeEvent, Category, Timeline, PartialDate (value object)
    services/        # TimelineLayout (posiciona nodos y ramas), EventFilter, validación
    errors/
  application/
    ports/           # TimelineRepository (out), TimelineView (out), FilterStateStore (out)
    usecases/        # LoadTimeline, ToggleCategoryFilter, SelectEvent, NavigateEvents, FollowStory
    TimelineController.ts   # orquesta casos de uso ↔ vista
  infrastructure/
    http/            # HttpJsonTimelineRepository (fetch + fallback)
    three/           # ThreeTimelineView + SceneBuilder, NodeMesh (glifos), BranchCurve, ParticleFlow, Watercolor, PostFX, CameraRig
    dom/             # FilterBar, EventPopup, Hud, Tooltip
    storage/         # UrlFilterStateStore (filtros en query string)
  main.ts            # composition root (única pieza que conoce todo)
```

- Dependencias solo hacia dentro: infrastructure → application → domain. Dominio y aplicación no importan `three` ni tocan `document`/`window`/`fetch`.
- SOLID: una responsabilidad por clase, puertos pequeños, inyección por constructor, extensible sin modificar (nuevas categorías = datos; nuevos efectos = nuevas clases que implementan una interfaz `SceneEffect`).
- `TimelineLayout` es puro y determinista: de `Timeline` → `{ nodes: {eventId, position{x,y,z}, branch}, branches: {id, points[], focus[], main, merge}, links: {from, to, fromBranch, toBranch, points[]}, band: {minY, maxY} }`. El eje X es el tiempo; los nodos van a la banda central y cada rama se desvía en Y/Z hacia su carril entre ellos (nace en `origin` o `branchFrom`).

## UX obligatoria

- Línea temporal 3D navegable: arrastrar/scroll para recorrer el tiempo, zoom, y teclas ←/→ para saltar entre eventos
  (de importancia ≥ 2; Mayús+←/→ nodo a nodo). Modo historia guiado por `story.path` (botón y tecla H).
- Nodo: hover → tooltip (título + fechas); clic/Enter → **pop-up** con todo el detalle del evento; Esc o clic fuera lo cierra; la cámara vuela al nodo.
- **Filtros por categoría** (chips con el color de cada una, multi-selección, "todas/ninguna"); los nodos filtrados se atenúan/desvanecen con transición, no desaparecen en seco. Estado reflejado en la URL.
- Marcas de año sobre el eje. HUD con nombre, tagline y contador de eventos visibles.
- VFX: fondo de acuarela en movimiento con parallax leve (estático con movimiento reducido), bloom contenido, motas de pigmento fluyendo por las ramas, aura de pigmento en los nodos mayores, niebla del color del papel, pulso al seleccionar.
- Accesibilidad: lista de eventos navegable por teclado/lector de pantalla (fallback DOM), `prefers-reduced-motion` reduce partículas y animación, foco gestionado en el pop-up (role="dialog" no modal: es un panel lateral y el resto sigue operable, así que no lleva `aria-modal` ni atrapa el foco; ver DOC_DISCREPANCIES A6).
- Responsive (móvil: pop-up a pantalla completa, gestos táctiles). Fallback legible si no hay WebGL.
- Rendimiento: partículas con `Points`/instancing, pixelRatio limitado a 2, pausar render con la pestaña oculta.

## Calidad

- `npm run lint && npm run typecheck && npm run test:coverage && npm run build` debe pasar en limpio.
- CI (GitHub Actions, `.github/workflows/ci.yml`): en push/PR a `develop` y `main` → lint, typecheck, `validate:data` del ejemplo, test con cobertura, build, `docker build` + prueba de humo con `curl`.
  `main` solo recibe cambios por PR desde `develop`.
- Flujo git: `main` (estable) ← `develop` ← `feature/*`. Merge a `main` solo con CI verde.
