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

19. **Jerarquía de nodos y declutter** (11/11/2026, feedback: «todo parece igual de relevante»).
    `NODE_TIERS` en `NodeMesh`: el menor (radio 0,17) no tiene halo, jaula, anillo ni satélites en
    reposo y crece ×1,9 al señalarlo; el medio (0,4) lleva halo suave y jaula; el mayor (0,74),
    halo amplio y anillo siempre. Rótulos: `labelDistanceLimit` = ∞ / 72 / 0 y `labelPriority` con
    escalones de 100 por nivel (+1000 fijado, +20 si ya estaba visible para evitar parpadeos). El
    tamaño de cada rótulo se **mide** (`offsetWidth/Height`) cuando se miden las zonas reservadas
    (cada 20 fotogramas); la estimación por caracteres se quedaba corta con Instrument Serif y era
    la causa de los solapes. Un rótulo que se oculta se va en 0,12 s (el que aparece tarda 0,45 s)
    para que nunca convivan dos en el mismo hueco. Los puntos menores no son obstáculo (un rótulo
    puede pasarles por encima); los medios y mayores sí. Se prueba una tercera posición (un poco
    más abajo). El pop-up, el índice, la tarjeta de capítulo y la franja de arcos también reservan.
20. **Arcos** (`arcs[]`). Contiguos sin solape con la regla «cada arco empieza cuando o después de
    que empiece el periodo `end` del anterior» (así `end: "2014"` y `start: "2014"` se aceptan; en la
    frontera gana el arco que empieza). `Timeline.arcAt` devuelve el último arco empezado si aún no ha
    terminado. En la escena (`ArcBands`) solo hay velo en el arco **activo**: un velo aditivo en
    todos los arcos, aunque fuera del 0,6 %, se veía como un bloque con borde duro en las zonas
    oscuras tras la conversión sRGB; el velo se difumina en vertical y un 30 % del ancho por cada lado.
    Los separadores usan mezcla normal (con aditiva el bloom los convertía en columnas blancas). El
    arco activo lo decide la X a la que mira la cámara (`CameraRig.lookX`, incluye el desplazamiento
    por el pop-up). Los títulos van en `ArcStrip`, una franja de 18 px entre la regla y los filtros
    (hueco que ya existía), no en la zona superior, que ocupa la cabecera en escritorio.
21. **Modo historia.** Estado en `TimelineController` (`StoryState`: paso, de dónde viene y si abre
    capítulo) con las reglas en `FollowStory`; el recorrido es `story.path` ∩ visibles. El estado
    viaja en `SelectionViewState.story` (opcional, para no romper a quien no lo usa) y, fuera del
    modo, `storyNextId`. Decisiones: cerrar el pop-up, soltar la selección o `Esc` salen de la
    historia (y `Esc`/salir cierran el detalle); pulsar un nodo del recorrido continúa desde él, uno
    ajeno sale; el filtro acorta el recorrido y, si oculta el paso actual, sale. El vuelo
    (`CameraRig.flyAlong`) recorre una ruta de `storyRoute`: X lineal en el tiempo, Y pegada a la
    línea de salida y mezclada con `smoothstep` hacia la de llegada (recta donde una línea no
    existe), con `easeInOutCubic`, duración 1,5–3,4 s según la distancia y un alejamiento de hasta 26
    unidades a mitad de camino. Cualquier gesto, `flyTo` o el movimiento reducido cortan el vuelo.
    La tarjeta de capítulo (`StoryControls`) no roba el foco (`role="status"`, `aria-live`): ←/→
    siguen funcionando y «Continuar» devuelve el foco al pop-up. En modo historia `app--story`
    recoge cabecera, filtros y ayuda (opacidad 0,12; en móvil, ocultos).
22. **←/→ por importancia.** `NavigateEvents` admite `granularity`: `major` (teclado sin Mayús) busca el
    siguiente visible con importancia ≥ 2 y, si no queda ninguno, cae al vecino; `all` (Mayús, y los
    botones del pop-up fuera de la historia) va nodo a nodo como antes.

23. **Banda narrativa** (11/11/2026, feedback: «difícil de seguir la historia saltando entre tantas
    líneas»). `TimelineLayout.assignBand`: cada nodo va a `y = clamp(carril × 0,42, ±1,5)` y, si otro
    nodo ya colocado está a menos de `stackDx` (1,4) en X y `stackGap` (1,25) en Y, se apila en el
    hueco libre más cercano alternando lado (empezando por el de su carril). Z = 0. La línea
    (`pointOnBranch`) es la curva de su carril (`pointOnLane`, el algoritmo de siempre) mezclada
    con la «recta de la banda» entre sus dos nodos vecinos: `out = smoothstep((x−a)/pinch) ×
    smoothstep((b−x)/pinch)` con `pinchX` 3,2. Así pasa exactamente por cada nodo y, cuanto más
    separados estén, más se aleja hacia su carril. Antes del primer nodo parte del origen; tras el
    último sale de la banda (o, si se fusiona, vuelve a ella en el nodo destino). Se compactaron los
    carriles (`laneSpacing` 3,6, `minLaneSpacing` 1,7, `maxLaneSpread` 6,5) y la ondulación sube a
    0,7. `round` normaliza −0 a 0. `SceneBuilder.bandFade` atenúa hasta un 45 % las líneas lejos de
    la banda. La apertura de cámara encuadra la banda ± 4,5 (las hebras pueden perderse por arriba o
    abajo). Rótulos: `labelSlots` alterna arriba/abajo por orden cronológico.
24. **`ledTo` (enlaces causales).** Dominio: `LifeEvent.ledTo` (sin duplicados) y
    `Timeline.consequencesOf / causesOf / causalLinks`, solo con eventos visibles (un destino
    privado oculto desaparece sin error). Validador: lista de ids existentes, no a sí mismo, sin
    repetir, destino con `start` ≥ el del origen (misma fecha permitida). `build:public-data` quita
    los destinos privados y borra la lista si queda vacía. Layout: `links[]` con una hebra que arquea
    (±0,7…2,4 en Y alternando signo, +0,8 en Z para ir por delante de las líneas) del nodo origen al
    destino. Escena: `BranchCurve` con `colorEnd` (degradado) y, si cambian de línea, un
    `MergeSeam` sin destello central (`core: 0`) como remolino. Pop-up: «Viene de…» y «Esto llevó
    a…» como botones (`onEventActivated`). Historia: si el paso siguiente es destino de un `ledTo`
    del actual, `CameraRig.flyAlong(routeAlong(link.points))`; si no, ruta recta por la banda
    (`storyRoute` sin líneas: seguir líneas que salen de la banda mareaba).
25. **Glifos por peso y forma** (`glyphShader.ts`, `NodeMesh`). Un cuadro por nodo que mira a la
    cámara con un fragment shader SDF (`fwidth` para el antialias: nítido a cualquier zoom); sustituye
    núcleo, jaula, halo, anillo y satélites. `uTier` (1/2/3) y `uStyle` (0 geometric, 1 organic, 2
    neutral). Peso 3 lleva aura de pigmento (ruido, se apaga antes del borde del cuadro); hover y
    foco suben `uAttention`, que la expande en todos. Se renderizan después de las líneas
    (`renderOrder` 5) con mezcla normal para que el relleno las tape. `BranchInfo.style` opcional;
    por defecto `defaultLineStyle(id)`. Los chips usan el estilo dominante de la categoría
    (`dominantStyles`: la línea con más eventos de esa categoría). Las categorías secundarias ya no
    se dibujan como satélites (el campo `secondaryColors` queda opcional y sin uso visual).
26. **Fondo de acuarela** (`Watercolor.ts`). Sustituye `Starfield`, `Nebula` y la textura de
    resplandor. `WatercolorPass` es el primer pase del compositor: dibuja `WatercolorWash` (domain
    warping con fbm en 3 niveles, borde acumulado como banda estrecha alrededor del umbral del
    lavado, segundo sangrado, paleta = colores de las líneas interpolados por un campo de ruido) en
    un render target a 1/2 de resolución y lo compone a pantalla completa añadiendo granulación
    (solo donde hay pigmento, densidad en alfa) y fibras de papel. El `RenderPass` va con
    `clear = false` y `clearDepth = true`; `scene.background = null`. Tinte: la línea con más foco en
    la X de la cámara (`focusAt`, la central gana empates), con transición lenta. Parallax 0,0035 por
    unidad de mundo. Movimiento reducido: tiempo congelado y tinte inmediato. Papel `#140e26`, que
    es también el color de la niebla. Bloom `strength` 0,42 / `radius` 0,48 / `threshold` 0,3 y golpe
    de selección 0,45 / 0,25: tinta luminosa, no neón. Las motas de `ParticleFlow` son gotas de
    pigmento del color de su línea (menos densidad, menos blanco).

27. **Eje ordinal y espaciado uniforme** (12/11/2026, feedback: «si antes era confuso ahora es un
    cacao; que los nodos siempre tengan la misma distancia»). Sustituye a la escala temporal, al
    apilado de la banda (decisión 23) y a las ondas de los carriles. `TimelineLayout.compute(timeline,
    visibleIds?)`: los visibles se ordenan con `compareOrdinal` (fecha, importancia desc, central
    primero, id) y `x = índice × nodeStep` (3,6). Todos los nodos en y = z = 0. Cada línea tiene
    «estaciones» (origen visible, sus nodos, nodo de fusión): entre dos estaciones contiguas (sin
    nodos en medio) va recta por la banda; si hay nodos ajenos, `y = carril × min(ss((x−a)/r),
    ss((b−x)/r))` con `smoothstep` (Hermite, tangentes horizontales: monótona, sin *overshoot*) y
    `r = min(0,75 paso, (b−a)/2)`. Antes de la primera y tras la última estación va por su carril
    (salvo la central si no hay nodos antes/después). Carriles: el *interval scheduling* de la
    decisión 13 en X ordinal; la central ocupa el primer nivel de abajo y las alturas se reparten en
    `[0,6, 1,15] × paso` (Z hasta −1,4). El muestreo añade los bordes exactos de cada rampa para que
    la Catmull-Rom centrípeta no redondee las esquinas. El foco de cada punto usa el año interpolado
    entre nodos (lineal a trozos; tras el último, hacia hoy) y el fin de los periodos, la inversa.
    `nowX` = último nodo + 0,8 pasos. Regla: `years` solo donde cambia el año (en el primer nodo de
    ese año); `YearRuler` rotula por prioridad (décadas > lustros > pares) con 52 px mínimos y los
    meridianos 3D van medio paso antes (entre nodos). Capítulos: de su primer nodo − ½ paso al último
    + ½ (el último abierto llega a hoy); sin nodos visibles no aparecen. `ledTo`: arco por encima
    (`y = h·sen(πs)`, `h = clamp(1,6 + 0,45·(pasos−1), ≤ 6,5)`, z +0,3), radio 0,035, realce 0,22
    en reposo, 1,6 si el nodo señalado/enfocado (o el paso de la historia) es uno de sus extremos y
    0,1 para las demás mientras tanto (`BuiltScene.highlightLinks`).
    **Filtros**: `LoadTimeline.relayout` → `FilterViewState.layout` (opcional). La vista reconstruye
    la escena si cambian los nodos; el primer filtro tras `render` (el guardado) se encuadra sin
    animar; los siguientes deslizan los nodos (`NodeMesh.slideFrom`, 0,75 s, *ease in-out*), las
    líneas aparecen desde cero (`BranchCurve.fadeIn`) y la cámara se traslada (`CameraRig.shiftX`)
    lo que se movió el nodo más cercano a su centro. Con movimiento reducido, todo inmediato.
    `NodeLabels` alterna arriba/abajo entre los nodos medios y mayores (los que se rotulan solos).
    **Cámara**: la apertura encuadra ~14 nodos (menos en pantallas estrechas, mínimo 5) con «hoy» a
    la derecha; la vista general cabe entera (tope 250; zoom máximo 260); guiñada 0,1 y cabeceo
    0,12 (antes 0,2/0,16) para que el paso constante se perciba constante.
    **Ruido**: motas a 0,7/unidad (máx. 900) y casi apagadas en la banda (`BAND_CLEAR_MIN` 0,12);
    `bandFade` deja las líneas al 50 % en su carril; costuras (30 motas, núcleo 1,1) y remolinos (14)
    más pequeños; bloom 0,36/0,42/0,38 con golpe de selección acotado (`MAX_KICK` 0,14), que era lo
    que sobreexponía junto a fusiones y remolinos. Acuarela: pesos de paleta afilados (`w³`, domina
    un pigmento), `tame()` desatura y enfría los amarillos (amarillo sobre ciruela daba oliva),
    densidad y fuerza menores (0,085) y el centro (banda) más limpio. Separadores de capítulo y
    meridianos más tenues. Filtros y ayuda suben a `pad + 58px`: la franja de capítulos ya no pisa
    la última fila de chips.

## Comprobación visual automatizada

`scripts/ui-check.mjs` abre la web en Chrome headless (WebGL por software) y recorre: escena,
hover, clic en nodo → pop-up, navegación, `Esc`, filtro (contador + URL), vista general, índice,
móvil, fallback sin WebGL, movimiento reducido con privados y modo historia (entrar, dos pasos,
tarjeta de capítulo, salida con `Esc`; capturas 12–16). Guarda capturas numeradas y sale con
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
window.__timelineDebug.story()          // { active, step }: modo historia y progreso ("3 / 22")
```

## Estado

Bloques del encargo (para reanudar si se corta la sesión):

| Bloque | Estado |
| --- | --- |
| 1. Dominio + aplicación + carga de datos + escena three | Hecho. Compila y se ve. |
| 2. Pop-up y filtros | Hecho (foco, Esc, clic fuera, chips, URL). Pop-up no modal desde el 11/11. |
| 3. VFX y pulido | Hecho (bloom, partículas, halos, niebla, pulso, rótulos, ramas cerradas que se disuelven en partículas). Desde el 11/11 el fondo es acuarela (decisión 26). |
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

Pasada de acuarela (11/11/2026, rama `feature/acuarela`): banda narrativa, `ledTo`, glifos por peso y
forma y fondo de acuarela (decisiones 23–26). Cadena de calidad en verde; `ui-check` «Todo correcto»
con datos reales y de ejemplo.

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
- La leyenda solo resalta líneas en la escena 3D; sin WebGL no se muestra.
- Las aristas de los nodos son `LineSegments` de 1 px (WebGL no admite grosor de línea): el brillo
  lo da el bloom. En pantallas de mucha densidad pueden verse finas.
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

### 28. Columna central recta y carriles más cercanos

- La línea central (`mainBranch`) ya no sube a su carril entre nodos: va siempre recta por la banda (y = 0) y un poco por detrás en Z (`mainBehind`), pasando por detrás de los símbolos de otras líneas. Elimina el "diente de sierra" que se veía en la vista general.
- Los carriles de las demás líneas se acercan a la banda (`laneMin` 0,42 y `laneMax` 0,78 pasos) para que sus curvas de bajada sean cortas y tranquilas.

### 29. La trenza: el foco en el centro, colores por línea y nodos 3D en wireframe

Feedback de Pablo (12/11/2026): la central no es «la línea de tecnología con todos los nodos», es el
foco, que ha ido cambiando; los colores deben ser coherentes (un nodo es del color de su línea); la
central debe ser la más destacada; iconos 3D (valen wireframes). Se conserva el eje ordinal y la calma.
Sustituye a la decisión 28 (la central ya no es una columna fija: el centro es la trenza).

- **Dominio (`Braid.ts`, puro).** `braidMembersAt(timeline, año)`: líneas cuyo `focus` contiene la
  fecha (cualquier `level`; fin incluido hasta el final de su mes/año); si ninguna, `[mainBranch]`.
  Una línea con `mergeInto` deja de existir en la fecha de la fusión (en ese instante ya es la
  destino) y, si su último periodo de foco llega hasta la fusión o no tiene eventos entre su final y
  la fusión, sigue en la trenza desde que empezó ese periodo («ya no sale»). `braidChangesOf` da las
  uniones/separaciones de una línea entre dos fechas (evaluando cada borde de foco o fusión a ±1e-4
  años); para una línea que se fusiona ignora los bordes a partir de la fusión.
- **Layout.** Cada línea que alguna vez sale de la trenza tiene un carril exterior fijo para toda su
  vida (*interval scheduling*; del lado de la línea en la que converge o de la que nace si eso ocurre
  fuera de la trenza; si no, del lado con menos líneas vivas; carriles en `[laneMin, laneMax]` =
  `[0,5, 0,8]` pasos). Sin focos, la central no necesita carril (`lane` 0) y es la trenza entera.
  Nodo: y = 0 si su línea está en la trenza en su fecha; si no, `laneY` (z = `laneZ`). La línea se
  construye con «estaciones» (origen, nodos propios, fusión, extremos) a altura fija y, entre cada
  par, una cadena de rampas: salida del origen hacia su estado, los cambios de foco que caen entre
  sus fechas y la llegada a la altura de la siguiente estación. Cada rampa (`smoothstep`, media
  anchura `ramp` = 0,7 pasos o menos si no cabe) se centra lo más cerca posible de la X de su fecha
  (`inverse` de la escala ordinal) sin solaparse con las demás ni invadir las estaciones: monótona,
  sin *overshoot* y los nodos quedan exactos. `braid[]` por punto = 1 − |y| / |laneY|. Salidas
  nuevas: `junctions` (unión/separación donde la rampa toca y = 0; fusión al final) y `braidSpans`
  (composición de la trenza por tramos de X, según la geometría: una línea cuenta si `braid` ≥ 0,5).
  Los `ledTo` suben `height` por encima del extremo más alto (los extremos pueden ir en carriles).
- **Escena.** Un solo color por línea (`timeline.lineColorOf`, también la central; `palette.trunk`
  solo si no hay color posible): nodos, tramos, motas, chispas, rótulos, tooltip, pop-up (acento y
  chip de la línea) y leyenda. `BranchCurve` admite `braid[]` (atributo por anillo) y `helix` (radio,
  fase, vueltas por unidad de X, velocidad): en el *vertex shader* el anillo se desplaza en YZ con
  `radio × braid`, así que la hélice solo existe en la trenza y la línea sale recta a su carril. Cada
  línea que pasa por la trenza añade dos fibras finas (`braidOnly`: se apagan fuera de ella) con otra
  fase, radio, paso y sentido de giro: la trenza se ve gruesa aunque en un tramo solo haya una línea.
  Grosor y brillo: 1 en la trenza, `outerWidth` 0,5 y `outer` 0,3 en el carril. Motas: un
  `ParticleFlow` para la trenza (foco = `braid`, `weighted`, `floor` 0, sin limpiar la banda, órbita
  0,55; densidad 2,4, máx. 1400) y otro casi vacío para las ramas exteriores (0,06, máx. 120). Chispas
  (`MergeSeam` pequeño) en cada unión y separación; costura completa en las fusiones. La acuarela
  pondera los pigmentos por `braid`. Los tramos de duración solo se dibujan fuera de la trenza.
  Hebras causales en reposo más discretas (0,14).
- **Nodos 3D (`NodeShapes.ts`, `NodeMesh.ts`).** Sustituyen a los glifos SDF (`glyphShader.ts`
  eliminado). Geometrías por estilo y peso a radio 1, compartidas en `NodeAssets.shape()`:
  geometric = icosaedro (aristas) + cubo inscrito / octaedro / tetraedro; organic = nudo toroidal /
  icosaedro subdividido deformado con ruido determinista / esfera de baja resolución (wireframe);
  neutral = dos anillos cruzados + anillo interior (giroscopio) / toro fino / un anillo. Aristas
  `LineSegments` aditivas (color de la línea apenas aclarado), relleno `MeshBasicMaterial` de papel
  teñido un 20 % (tapa la trenza al pasar por detrás; `renderOrder` 5, aristas 6) y un aura en
  cuadro que mira a la cámara (solo el peso 3 en reposo; todos al señalarlos). Giro lento
  (0,32 rad/s, la estructura interior al revés); quietos con movimiento reducido. Hover/selección:
  crece (`lift`), gira algo más deprisa y las aristas suben de brillo con tope 1.
- **Interfaz.** Chips de categoría y etiquetas de categoría del pop-up en neutro (`NEUTRAL_CHIP`)
  con su icono y su forma: el color significa siempre «línea vital» y dos códigos de color
  compitiendo era justo la incoherencia que señalaba Pablo. Rótulos: halo oscuro detrás (las ramas
  pasan por detrás sin cortar la lectura); los nodos de ramas exteriores se rotulan solo hacia fuera
  (si no cabe, se oculta). Leyenda: `LineLegend` es también `ProjectionListener`; con
  `ProjectedFrame.lookX` busca el tramo de `braidSpans` y marca «en foco ahora» (clase
  `line--braided`, swatch grueso); «latente» se oculta mientras la línea va por la trenza. La
  central ya no lleva «foco actual» fijo.
