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
  ghost?: boolean;            // «camino que no fue»: nace en origin, ~1,25 pasos tenue con su nombre, se disuelve; sin eventos
  pauses?: { from: string; to: string }[]; // no se dibuja entre esos eventos (se disuelve tras from, renace en to)
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
  alsoBranches?: string[];    // nodo de unión: otras líneas que pasan por él (convergen y vuelven a salir)
  active?: boolean;           // proyecto/etapa vivo hoy: late, «En activo», su línea avanza hasta hoy
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
`"main"`); `until` solo `"present"` y nunca con `mergeInto`; la central no admite `mergeInto` (sí
`origin` y `pauses`: `mainBranch` es la línea del foco actual); `origin` puede ser el primer evento
de la propia línea (nace en ese nodo). Uniones, caminos que no fueron y pausas (`LineLifeRules`):
`alsoBranches` con líneas existentes y no ghost, sin la dueña ni duplicados, vivas en la fecha
(nacidas, sin fusionar, sin terminar, sin pausa); `ghost` exige `origin` y prohíbe eventos propios,
`until`, `mergeInto` y `pauses`; `pauses` con eventos existentes, `from` < `to`, sin solapes y sin
eventos propios dentro; `active` booleano.
Errores acumulados con ruta (`events[3].date.start: ...`, `branches[1].mergeInto.event: ...`), no solo el primero.

Jerarquía, arcos e historia: nodos = sólidos 3D en wireframe (aristas luminosas del color de su línea,
relleno interior tenue, giro lento; quietos con movimiento reducido). `importance` 3 = sólido compuesto
grande con aura y rótulo siempre; 2 = sólido sencillo, rótulo al acercarse si cabe; 1 = sólido pequeño
sin aura ni rótulo salvo hover/foco/selección. Forma por línea (`style`, por defecto `tecnologia`/`gestion` →
geometric; `arte`/`gastronomia`/`rol` → organic; resto → neutral): geometric = icosaedro + cubo inscrito,
octaedro, tetraedro; organic = nudo toroidal, esfera deformada, esfera pequeña; neutral = giroscopio de
anillos, toro fino, anillo. Hover/selección: se expande y brilla un poco. Chips y leyenda usan
el mismo lenguaje.
Trenza (desde el 12/11/2026, decisión 29): en cada fecha las líneas en foco viajan juntas por el
centro (y = 0) entrelazándose (hélice lenta, fibras extra, flujo denso de motas): es lo más destacado.
Sin líneas en foco, la trenza es `mainBranch`. Fuera de foco cada línea va recta por su carril
exterior fijo (fina, tenue, casi sin motas); al entrar en foco se une con una curva corta y monótona
entre dos de sus nodos y al salir se separa (chispa en cada unión/separación). `mergeInto` termina
dentro de la trenza y no vuelve a salir. Nodo: y = 0 si su línea está en la trenza en su fecha; si no,
el y del carril de su línea. Color único = el de la línea (nodo, aura, rótulo, pop-up, leyenda); las
categorías solo filtran y sus chips son neutros. Rótulos: los de la trenza alternan arriba/abajo; los
de ramas exteriores, siempre hacia fuera; halo oscuro tras cada rótulo. Nodos de unión (decisión 30): las líneas de `alsoBranches` llegan al nodo (rampa suave desde su
carril) y salen enseguida; nodo en y = 0 si la dueña **o alguna de `alsoBranches`** está en la trenza
en su fecha; anillo plano multicolor de cara a la cámara (≥ 4 líneas: ×1,28 y rótulo siempre);
pop-up «Líneas: …». `origin`: la línea arranca en el nodo con chispa. Pausas: tras `from` la línea
sigue recta ≤ 0,55 pasos y se deshilacha en motas; renace con chispa en `to`; sin puntos entre medias
y fuera de la trenza. Ghosts: hebra tenue de 1,25 pasos desde el origen hacia fuera, rótulo en
cursiva al acercarse; no están en la leyenda de líneas. `active`: aura y anillo laten (2,4 s), «En
activo» junto al rótulo y una punta con estela que avanza hasta el final de la línea (quieta al final
con movimiento reducido). Leyenda: claves «Encrucijada», «En activo», «Camino que no fue».
Antes de nacer la central (o en su pausa), sin focos, la trenza es la línea del primer evento.
`ledTo` = hebra de tinta del nodo origen al
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
los ids privados y conserva los arcos; también quita de `ledTo` los destinos privados, las pausas con
un extremo privado, reengancha o quita los ghosts con origen privado y limpia `alsoBranches`.

Comportamiento visual de las líneas: grosor, brillo y motas según la pertenencia a la trenza
(`LayoutBranch.braid`, 0 en el carril … 1 en el centro); las que comparten `origin` salen del mismo
punto; `focusIntensityAt` sigue en el dominio (`LayoutBranch.focus`) pero la escena usa `braid`;
`mergeInto` termina en el nodo destino con una costura de partículas; `until: "present"` llega a hoy atenuada; el resto se
disuelve como las ramas cerradas. Leyenda DOM accesible encima de los filtros (plegable en móvil) que
resalta la línea en la escena al pasar el ratón y marca «en foco ahora» las líneas de la trenza en la
zona que mira la cámara (`LayoutResult.braidSpans` + `ProjectedFrame.lookX`).

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
    three/           # ThreeTimelineView + SceneBuilder, NodeMesh + NodeShapes (sólidos wireframe), BranchCurve (líneas y trenza), ParticleFlow, Watercolor, PostFX, CameraRig
    dom/             # FilterBar, EventPopup, Hud, Tooltip
    storage/         # UrlFilterStateStore (filtros en query string)
  main.ts            # composition root (única pieza que conoce todo)
```

- Dependencias solo hacia dentro: infrastructure → application → domain. Dominio y aplicación no importan `three` ni tocan `document`/`window`/`fetch`.
- SOLID: una responsabilidad por clase, puertos pequeños, inyección por constructor, extensible sin modificar (nuevas categorías = datos; nuevos efectos = nuevas clases que implementan una interfaz `SceneEffect`).
- `TimelineLayout` es puro y determinista: de `Timeline` (y, opcionalmente, los ids visibles) → `{ nodes: {eventId, position{x,y,z}, branch, index, lines[]}, branches: {id, points[], focus[], braid[], laneY, main, merge, gaps[]}, links: {from, to, fromBranch, toBranch, points[]}, junctions: {branch, kind: join|split|merge|birth|fray, position}, braidSpans: {startX, endX, members[]}, ghosts: {id, originEventId, points[], side}, actives: {eventId, branch, points[]}, years, arcs, nodeStep, band }`. El eje X es **ordinal**: los nodos visibles, en orden cronológico (desempate: importancia, línea central, id), se separan siempre `nodeStep`. La pertenencia a la trenza por fecha sale de `Braid` (`braidMembersAt`, `isInBraidAt`, `braidChangesOf`; dominio, puro). Nodos en y = 0 (trenza) o en el carril fijo de su línea (±0,5–0,8 pasos); uniones y separaciones con *smoothstep* entre dos nodos de la línea. Los `ledTo` son arcos por encima de sus extremos. Al filtrar se recalcula con los visibles.

## UX obligatoria

- Línea temporal 3D navegable: arrastrar/scroll para recorrer el tiempo, zoom, y teclas ←/→ para saltar entre eventos
  (de importancia ≥ 2; Mayús+←/→ nodo a nodo). Modo historia guiado por `story.path` (botón y tecla H).
- Nodo: hover → tooltip (título + fechas); clic/Enter → **pop-up** con todo el detalle del evento; Esc o clic fuera lo cierra; la cámara vuela al nodo.
- **Filtros por categoría** (chips con el color de cada una, multi-selección, "todas/ninguna"); los nodos filtrados salen del eje y los visibles se deslizan a su nueva posición (transición suave), no saltan en seco. Estado reflejado en la URL.
- Regla ordinal: una marca donde cambia el año entre nodos consecutivos (en el primer nodo de ese año) y los capítulos como tramos que abarcan sus nodos. HUD con nombre, tagline y contador de eventos visibles.
- VFX: fondo de acuarela en movimiento con parallax leve (estático con movimiento reducido), bloom contenido, motas de pigmento fluyendo por las ramas, aura de pigmento en los nodos mayores, niebla del color del papel, pulso al seleccionar.
- Accesibilidad: lista de eventos navegable por teclado/lector de pantalla (fallback DOM), `prefers-reduced-motion` reduce partículas y animación, foco gestionado en el pop-up (role="dialog" no modal: es un panel lateral y el resto sigue operable, así que no lleva `aria-modal` ni atrapa el foco; ver DOC_DISCREPANCIES A6).
- Responsive (móvil: pop-up a pantalla completa, gestos táctiles). Fallback legible si no hay WebGL.
- Rendimiento: partículas con `Points`/instancing, pixelRatio limitado a 2, pausar render con la pestaña oculta.

## Calidad

- `npm run lint && npm run typecheck && npm run test:coverage && npm run build` debe pasar en limpio.
- CI (GitHub Actions, `.github/workflows/ci.yml`): en push/PR a `develop` y `main` → lint, typecheck, `validate:data` del ejemplo, test con cobertura, build, `docker build` + prueba de humo con `curl`.
  `main` solo recibe cambios por PR desde `develop`.
- Flujo git: `main` (estable) ← `develop` ← `feature/*`. Merge a `main` solo con CI verde.
