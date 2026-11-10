# Informe de QA (agente 3)

Fecha: 10/11/2026. Alcance: batería de tests unitarios y de integración con Vitest (jsdom) sobre
el código de `src/` entregado por el agente 2.

## Resultado

`npm run lint && npm run typecheck && npm run test:coverage && npm run build` pasa en limpio.

- **758 tests en 43 ficheros**, todos en verde (antes: 6 tests de humo, cobertura ≈ 20 %).
- Umbral global del 75 % sin tocar; `vitest.config.ts` no se ha modificado.

| Métrica | Cobertura | Cubierto / total |
| --- | --- | --- |
| Sentencias | **99,67 %** | 1817 / 1823 |
| Ramas | **97,44 %** | 917 / 941 |
| Funciones | **100 %** | 406 / 406 |
| Líneas | **99,87 %** | 1593 / 1595 |

### Por capa

| Capa | Ficheros | Sentencias | Ramas | Funciones | Líneas |
| --- | --- | --- | --- | --- | --- |
| `domain` | 14 | 99,79 % | 98,41 % (310/315) | 100 % | 100 % |
| `application` | 6 | 97,89 % | 96,55 % (56/58) | 100 % | 100 % |
| `infrastructure/http` | 1 | 100 % | 100 % (18/18) | 100 % | 100 % |
| `infrastructure/storage` | 1 | 100 % | 100 % (10/10) | 100 % | 100 % |
| `infrastructure/dom` | 14 | 99,57 % | 98,18 % (270/275) | 100 % | 99,49 % |
| `infrastructure/three` | 16 | 99,86 % | 95,47 % (253/265) | 100 % | 100 % |

Las cifras por capa salen de agregar el `coverage-summary.json` de v8 por directorio (misma
ejecución que el total).

## Qué se prueba

| Área | Ficheros de test | Lo esencial |
| --- | --- | --- |
| Dominio | `tests/domain/**` (11) | `PartialDate` (formatos, bisiestos, precisión, comparación, formato con locale inválido); validador (cada regla con su ruta y mensaje, errores acumulados en orden de documento, ciclos de ramas, nunca lanza); `Timeline`; `TimelineFactory` (visibilidad `private`, valores por defecto, filtro de URLs); `TimelineLayout` (determinismo, eje X, `branchFrom` exacto, origen oculto, ramas anidadas, carriles, tramos, límites); `EventFilter`; `isHttpUrl`; errores. |
| Aplicación | `tests/application/**` (2) | Los cuatro casos de uso y `TimelineController` con vista, repositorio y almacén falsos: orden de llamadas, filtro restaurado, selección/navegación, conciliación al filtrar, fallo de carga. |
| HTTP / URL | `tests/infrastructure/http`, `storage` (2) | 200; 404 → ejemplo; 403/500; JSON mal formado; JSON que no valida (aviso + `rejectedIssues`); error de red en uno y en ambos; `primary: null`. Filtro en la query (ida y vuelta, `cat=` ≠ sin `cat`, conserva ruta, parámetros y hash). |
| DOM | `tests/infrastructure/dom/**` (13) | `FilterBar`; `EventPopup` (`role="dialog"`, `aria-modal`, foco al abrir, devolución del foco, trampa de Tab, clic fuera, enlaces `rel="noopener noreferrer"`, media); `Tooltip`; `Hud`; `EventList`; `KeyboardShortcuts`; `LiveAnnouncer`; `ViewControls`; `YearRuler`; `NodeLabels`; `labelLayout`; `CompositeTimelineView`; `dom.ts`. |
| three | `tests/infrastructure/three/**` (10) | `math`, `CameraRig`, `RenderLoop` (pausa con pestaña oculta, delta acotado), `PointerInput` (toque, arrastre, pellizco, rueda), texturas, `NodeMesh`, efectos, `SceneBuilder`, `ThreeTimelineView` con backend falso (tamaño, pixelRatio ≤ 2, proyección, filtro, selección, hover, clic), `webgl.ts` y `PostFX` con three mockeado. |
| Datos | `tests/data/example-data.test.ts` | `public/data/life.example.json` pasa el validador del dominio sin errores, solo tiene URLs http(s), no contiene marcado HTML y se puede disponer con y sin privados. |
| Seguridad | `tests/security/xss.test.ts` | Ver abajo. |
| Integración | `tests/integration/app-flow.test.ts` | Flujos completos sin escena 3D: carga/fallback, `?private=1`, filtros ↔ URL, teclado (→, Enter, Esc), índice, clic fuera. |
| Schema y script | `tests/schema`, `tests/scripts` | Coherencia schema ↔ validador (obligatorios, enumeraciones, patrones); `validate-data.ts` con códigos de salida 0 / 1 / 2. |

### Seguridad

- Un JSON **válido** con `<img onerror>`, `<script>`, `<svg onload>` y comillas hostiles en todos
  los campos de texto se pinta en todos los componentes (HUD, filtros, índice, pop-up, tooltip,
  rótulos, anunciador, título del documento): no se crea ningún elemento a partir del texto, no
  hay atributos `on*`, y el centinela `window.__xss` no se toca.
- URLs `javascript:`, `data:`, `vbscript:`, `file:`, relativas al protocolo y con espacios o
  tabuladores: rechazadas por el validador (capa 1), descartadas por `TimelineFactory` (capa 2) y
  por `safeLink()` en el DOM (capa 3), cada capa probada por separado saltándose las anteriores.
- Un `life.json` con una URL `javascript:` se descarta entero y se cargan los datos de ejemplo.
- Comprobación estática: ningún fichero de `src/` usa `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `DOMParser`, `eval` ni `new Function`.

## Bugs encontrados y corregidos

Los tres están en `src/infrastructure/dom`, se corrigieron con el cambio mínimo y tienen test de
regresión (fallaba antes del arreglo, pasa después).

| Id | Gravedad | Fichero | Problema | Arreglo | Test de regresión |
| --- | --- | --- | --- | --- | --- |
| BUG-1 | Media (accesibilidad) | `EventList.ts` | El enlace «Saltar al índice de eventos» de `index.html` (`href="#index"`) apunta a `<nav id="index" hidden>`. Con la escena 3D activa el índice está oculto (`[hidden] { display: none !important }`), así que el primer elemento que encuentra quien navega con teclado no hacía nada. | `EventList` enlaza los `<a href="#<id del índice>">` del documento: al activarlos abre el índice y lleva el foco al primer evento disponible. | `EventList.test.ts` › «regresión (BUG-1)…» y «…modo sin WebGL» |
| BUG-2 | Baja | `ViewControls.ts` | Los atajos `+`, `−` y `0` no comprobaban modificadores: `Ctrl`/`⌘` + `+`/`−`/`0` (zoom del navegador) movía además la cámara, y `Ctrl+0` lanzaba la vista general. `KeyboardShortcuts` sí los respetaba. | Se ignoran las teclas con `Ctrl`, `⌘` o `Alt`. | `ViewControls.test.ts` › «regresión (BUG-2)…» |
| BUG-3 | Baja (accesibilidad) | `EventPopup.ts` | Al cerrarse, el pop-up devolvía siempre el foco al elemento que lo tenía al abrir. Si se cerraba porque el usuario pulsó un chip de filtro que ocultaba el evento abierto, le quitaba el foco al chip. | El foco solo se devuelve si sigue dentro del pop-up o se ha perdido (`<body>`). | `EventPopup.test.ts` › «regresión (BUG-3)…» y «si el foco se había perdido…» |

BUG-1 no se ha comprobado en un navegador real: `scripts/ui-check.mjs` no se ha vuelto a ejecutar
tras los arreglos (necesita Chrome y `puppeteer-core`, que no son dependencias del proyecto).
Conviene pasarlo antes de publicar.

No se ha hecho ningún refactor de `src/` para facilitar los tests.

## Exclusiones de cobertura

Ninguna nueva. Siguen excluidos solo `src/main.ts` (composition root) y los ficheros que
únicamente declaran tipos, como ya estaba. `webgl.ts` y `PostFX.ts`, que DEV_NOTES señalaba como
lo único que exige WebGL real, están cubiertos sustituyendo `WebGLRenderer` y las pasadas de
postprocesado con `vi.mock`.

## Huecos conocidos

Ramas sin cubrir (24 de 941). Son defensivas o inalcanzables con datos válidos:

- `TimelineController` (2): los `if (!this.timeline) return` de `pushFilter` / `pushSelection`,
  inalcanzables porque quien los llama ya lo comprueba.
- `EventPopup` (3): el caso «no hay nada enfocable» de `trapFocus` no puede darse (el botón de
  cerrar siempre existe); el resto son comprobaciones defensivas.
- `LifeDataValidator` (1), `TimelineLayout` (4), `SceneBuilder` (3), `ThreeTimelineView` (5),
  `FilterBar` (1), `NodeLabels` (1), `ParticleFlow` (1), `PointerInput` (2), `math` (1): alternativas `??` / `?.`
  para valores que el propio código garantiza.

Lo que estos tests **no** demuestran:

- **Render real.** No se ejecuta ningún shader: GLSL, bloom, niebla y aspecto visual solo los cubre
  `scripts/ui-check.mjs` (fuera de `npm test`). Con three mockeado, `webgl.test.ts` comprueba la
  configuración que se le pasa al renderer, no que three la acepte.
- **`src/main.ts`** (cableado, `matchMedia`, `?nowebgl`, `?debug`) no tiene test unitario;
  `tests/helpers/app.ts` replica su cableado sin la escena, así que una errata en `main.ts` no la
  detectaría.
- **CSS.** jsdom no calcula layout: responsive, pop-up a pantalla completa en móvil, transiciones y
  `prefers-reduced-motion` a nivel de CSS no se prueban. El movimiento reducido sí se prueba en la
  lógica (cámara, nodos, partículas, pulso, bloom).
- **JSON Schema.** No hay `ajv`: el JSON de ejemplo no se valida contra `schema/life.schema.json`;
  solo se comprueba que schema y validador no se contradicen.
- **Docker, nginx y CSP**: fuera del alcance de los tests unitarios.
- **Navegadores reales y táctil**: `PointerInput` se prueba con eventos sintéticos.

Observaciones sobre el producto (no se han cambiado; son decisiones, no fallos claros):

1. **Rama que empieza antes que su origen.** El validador no exige que los eventos de una rama
   sean posteriores a su `branchFrom`. Si el primer evento de la rama es anterior, el layout
   arranca la rama antes del nodo de origen (a su altura, pero en otra X), y la bifurcación no
   sale visualmente del nodo. Valdría una regla más en el validador.
2. **`aria-modal="true"` en un panel que no es modal.** El contrato lo pide, pero la escena y los
   filtros siguen siendo utilizables con el ratón mientras el pop-up está abierto (DEV_NOTES,
   decisión 5). Para un lector de pantalla, `aria-modal` declara inerte todo lo demás.
3. **`media` se filtra en dos capas, no en tres.** Los enlaces pasan por validador, fábrica y
   `safeLink()`; las imágenes solo por validador y fábrica (`EventPopup` asigna `img.src` sin
   volver a comprobarlo). No es explotable con el flujo actual.
4. **Doble clic sobre el único chip activo** lo deja como estaba (el primer clic lo apaga y el
   segundo lo aísla de nuevo), mientras que `Alt`+clic en ese caso vuelve a «todas».
