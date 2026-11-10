# Contrato del proyecto (fuente de verdad para todos los agentes)

Proyecto: **alter-timeline-portfolio** — portfolio/CV interactivo de Pablo Fernández Alonso
(desarrollador multidisciplinar y tech artist, Donostia). La vida se muestra como una
**línea temporal ramificada** con nodos; cada bifurcación vital abre una rama ("otro yo").
Diseño visual ORIGINAL (no copiar arte, logos, nombres ni UI de ningún videojuego):
estética sci-fi etérea, partículas, bloom, niebla, energía fluyendo por las ramas.

## Stack

- Vite + TypeScript (strict) + three.js (postprocesado: EffectComposer + UnrealBloomPass).
- Sin framework de UI: DOM nativo para overlay (filtros, pop-up, HUD).
- Tests: Vitest + @vitest/coverage-v8, entorno jsdom. Umbral global ≥ 75 % (lines, functions, branches, statements).
- Lint: ESLint + typescript-eslint. `npm run typecheck` = `tsc --noEmit`.
- Docker: multi-stage (node:22-alpine build → nginx:alpine). `docker-compose.yml` expone `8080:80`
  y monta `./data/life.json` en `/usr/share/nginx/html/data/life.json:ro`.
- Scripts npm: `dev`, `build`, `preview`, `test`, `test:coverage`, `lint`, `typecheck`, `validate:data`.

## Datos (privacidad)

- `public/data/life.example.json` — datos FICTICIOS, sí se commitea.
- `data/life.json` — datos REALES de Pablo. **Nunca en git** (`/data/life.json` y `/public/data/life.json` en `.gitignore`,
  y `data/` en `.dockerignore` para que no entre en la imagen; se monta como volumen).
- En runtime el cliente hace `GET /data/life.json`; si responde 404 o no valida, cae a `GET /data/life.example.json`
  y muestra un aviso discreto "datos de ejemplo".
- En `npm run dev`, un plugin de Vite sirve `data/life.json` en `/data/life.json` si existe.
- `schema/life.schema.json` — JSON Schema (draft 2020-12) equivalente al tipo de abajo.
- `npm run validate:data [ruta]` valida un JSON con el mismo validador del dominio.

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
  };
  categories: Category[];     // N categorías, definidas en datos, no en código
  events: LifeEvent[];
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
  importance?: 1 | 2 | 3;     // tamaño/brillo del nodo; por defecto 2
  branch?: string;            // id de rama; por defecto "main"
  branchFrom?: string;        // id del evento del que nace esta rama (bifurcación)
  visibility?: "public" | "private"; // "private" se oculta salvo ?private=1
}
```

Reglas de validación (dominio): ids únicos; categorías referenciadas existen; `branchFrom` existe;
fechas con formato válido y `end >= start`; color hex válido; URLs http(s). Errores acumulados con ruta
(`events[3].date.start: ...`), no solo el primero.

## Arquitectura hexagonal

```
src/
  domain/            # puro, sin three ni DOM ni fetch
    model/           # LifeEvent, Category, Timeline, PartialDate (value object)
    services/        # TimelineLayout (posiciona nodos y ramas), EventFilter, validación
    errors/
  application/
    ports/           # TimelineRepository (out), TimelineView (out), FilterStateStore (out)
    usecases/        # LoadTimeline, ToggleCategoryFilter, SelectEvent, NavigateEvents
    TimelineController.ts   # orquesta casos de uso ↔ vista
  infrastructure/
    http/            # HttpJsonTimelineRepository (fetch + fallback)
    three/           # ThreeTimelineView + SceneBuilder, NodeMesh, BranchCurve, ParticleFlow, Starfield, PostFX, CameraRig
    dom/             # FilterBar, EventPopup, Hud, Tooltip
    storage/         # UrlFilterStateStore (filtros en query string)
  main.ts            # composition root (única pieza que conoce todo)
```

- Dependencias solo hacia dentro: infrastructure → application → domain. Dominio y aplicación no importan `three` ni tocan `document`/`window`/`fetch`.
- SOLID: una responsabilidad por clase, puertos pequeños, inyección por constructor, extensible sin modificar (nuevas categorías = datos; nuevos efectos = nuevas clases que implementan una interfaz `SceneEffect`).
- `TimelineLayout` es puro y determinista: de `Timeline` → `{ nodes: {eventId, position{x,y,z}, branch}, branches: {id, points[]} }`. El eje X es el tiempo; cada rama se desvía en Y/Z desde su `branchFrom`.

## UX obligatoria

- Línea temporal 3D navegable: arrastrar/scroll para recorrer el tiempo, zoom, y teclas ←/→ para saltar entre eventos.
- Nodo: hover → tooltip (título + fechas); clic/Enter → **pop-up** con todo el detalle del evento; Esc o clic fuera lo cierra; la cámara vuela al nodo.
- **Filtros por categoría** (chips con el color de cada una, multi-selección, "todas/ninguna"); los nodos filtrados se atenúan/desvanecen con transición, no desaparecen en seco. Estado reflejado en la URL.
- Marcas de año sobre el eje. HUD con nombre, tagline y contador de eventos visibles.
- VFX: bloom, partículas fluyendo por las ramas, campo de polvo/estrellas con parallax, halo pulsante en nodos, niebla de profundidad, pulso al seleccionar.
- Accesibilidad: lista de eventos navegable por teclado/lector de pantalla (fallback DOM), `prefers-reduced-motion` reduce partículas y animación, foco gestionado en el pop-up (role="dialog" no modal: es un panel lateral y el resto sigue operable, así que no lleva `aria-modal` ni atrapa el foco; ver DOC_DISCREPANCIES A6).
- Responsive (móvil: pop-up a pantalla completa, gestos táctiles). Fallback legible si no hay WebGL.
- Rendimiento: partículas con `Points`/instancing, pixelRatio limitado a 2, pausar render con la pestaña oculta.

## Calidad

- `npm run lint && npm run typecheck && npm run test:coverage && npm run build` debe pasar en limpio.
- CI (GitHub Actions, `.github/workflows/ci.yml`): en push/PR a `develop` y `main` → lint, typecheck, test con cobertura, build, `docker build`.
- Flujo git: `main` (estable) ← `develop` ← `feature/*`. Merge a `main` solo con CI verde.
