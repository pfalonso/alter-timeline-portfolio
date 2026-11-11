#!/usr/bin/env node
/**
 * Comprobación visual automatizada: abre la web en Chrome headless, hace capturas de la escena,
 * de un pop-up, de un filtro activo, de la vista móvil, del fallback sin WebGL y del modo historia
 * (entrar, avanzar dos pasos y la tarjeta de un capítulo nuevo).
 *
 * puppeteer-core NO es dependencia del proyecto. Instálalo fuera del repo y apunta NODE_PATH:
 *   npm i --prefix /tmp/ui-check puppeteer-core
 *   npm run build && npm run preview &            # o cualquier servidor con la web
 *   NODE_PATH=/tmp/ui-check/node_modules node scripts/ui-check.mjs \
 *       --url http://localhost:4173 --out /tmp/ui-shots [--example] [--event <id>] [--category <id>]
 *
 * Variables: CHROME_BIN (por defecto /usr/bin/google-chrome).
 * Sale con código 1 si alguna comprobación falla.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const baseUrl = option('url', 'http://localhost:4173');
const outDir = resolve(option('out', './out/ui-check'));
const settleMs = Number(option('settle', '6000'));
const wantedEvent = option('event', null);
const wantedCategory = option('category', null);
const useExample = flag('example');

const require = createRequire(join(process.cwd(), 'noop.js'));
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  console.error('No se encuentra puppeteer-core. Instálalo fuera del repo:\n  npm i --prefix /tmp/ui-check puppeteer-core\ny ejecuta con NODE_PATH=/tmp/ui-check/node_modules');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${message}`);
  if (!condition) failures.push(message);
};
const pageUrl = (params = {}) => {
  const url = new URL(baseUrl);
  url.searchParams.set('debug', '1');
  if (useExample) url.searchParams.set('example', '1');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
  ],
});

async function open(viewport, params) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    // El 404 de /data/life.json es el camino normal cuando no hay datos personales (fallback al ejemplo).
    const expected404 = /\/data\/life\.json(\?|$)/.test(message.location()?.url ?? '');
    if (message.type() === 'error' && !expected404) errors.push(message.text().slice(0, 300));
  });
  await page.goto(pageUrl(params), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__timelineDebug?.ready !== undefined, { timeout: 30000 });
  return { page, errors };
}
const shot = async (page, name) => {
  const file = join(outDir, name);
  await page.screenshot({ path: file });
  console.log(`  →   ${file}`);
};
const visibleNodes = (page) => page.evaluate(() => window.__timelineDebug.nodes().filter((node) => node.visible));

try {
  // 1. Escritorio: escena, hover, pop-up, navegación, filtro.
  console.log(`\n[escritorio 1440×900] ${pageUrl()}`);
  const { page, errors } = await open({ width: 1440, height: 900 });
  const state = await page.evaluate(() => ({ ready: window.__timelineDebug.ready, webgl: window.__timelineDebug.webgl }));
  check(state.ready, 'los datos cargan');
  check(state.webgl, 'WebGL disponible (escena 3D activa)');
  await sleep(settleMs);
  await shot(page, '01-escena.png');
  check((await page.$$('#filters .chip')).length >= 1, 'hay chips de filtro');
  check(((await page.$eval('#hud', (node) => node.textContent)) ?? '').length > 0, 'el HUD tiene contenido');
  const notice = await page.$('[data-testid="example-notice"]');
  console.log(`  ·   aviso "datos de ejemplo": ${notice ? 'visible' : 'no (datos personales)'}`);

  let nodes = await visibleNodes(page);
  check(nodes.length > 0, `hay nodos visibles en pantalla (${nodes.length})`);
  const target = nodes.find((node) => node.id === wantedEvent) ?? nodes[Math.floor(nodes.length / 2)];
  if (target) {
    await page.mouse.move(target.x, target.y);
    await sleep(500);
    check(await page.$eval('#tooltip', (node) => !node.hidden), 'el hover muestra el tooltip');
    await shot(page, '02-hover.png');
    await page.mouse.click(target.x, target.y);
    await sleep(2600);
    check(await page.$eval('#popup', (node) => !node.hidden), `clic en el nodo "${target.id}" abre el pop-up`);
    check(await page.evaluate(() => document.activeElement?.closest('#popup') !== null), 'el foco está dentro del pop-up');
    await shot(page, '03-popup.png');
    await page.keyboard.press('ArrowRight');
    await sleep(2400);
    await shot(page, '04-popup-siguiente.png');
    await page.keyboard.press('Escape');
    await sleep(600);
    check(await page.$eval('#popup', (node) => node.hidden), 'Esc cierra el pop-up');
  }

  const chip = (wantedCategory && (await page.$(`#filters .chip[data-category="${wantedCategory}"]`))) || (await page.$('#filters .chip'));
  if (chip) {
    const before = await page.$eval('.hud__counter', (node) => node.textContent);
    await chip.click();
    await sleep(1800);
    const after = await page.$eval('.hud__counter', (node) => node.textContent);
    check(before !== after, `desactivar una categoría cambia el contador (${before} → ${after})`);
    check(new URL(page.url()).searchParams.has('cat'), 'el filtro se refleja en la URL (?cat=)');
    await shot(page, '05-filtro.png');
    await chip.click();
  }
  await page.keyboard.press('0');
  await sleep(3200);
  await shot(page, '06-vista-general.png');
  await page.click('#index-toggle');
  await sleep(500);
  await shot(page, '07-indice.png');
  check(errors.length === 0, `sin errores de consola${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();

  // 2. Móvil.
  console.log('\n[móvil 390×844]');
  const mobile = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(settleMs);
  await shot(mobile.page, '08-movil.png');
  nodes = await visibleNodes(mobile.page);
  if (nodes[0]) {
    await mobile.page.touchscreen.tap(nodes[0].x, nodes[0].y);
    await sleep(2200);
    check(await mobile.page.$eval('#popup', (node) => !node.hidden), 'toque en un nodo abre el pop-up (móvil)');
    await shot(mobile.page, '09-movil-popup.png');
  }
  check(mobile.errors.length === 0, `sin errores de consola (móvil)${mobile.errors.length ? `: ${mobile.errors.join(' | ')}` : ''}`);
  await mobile.page.close();

  // 3. Fallback sin WebGL.
  console.log('\n[sin WebGL]');
  const fallback = await open({ width: 1280, height: 800 }, { nowebgl: '1' });
  await sleep(3000);
  check(await fallback.page.$eval('#index', (node) => !node.hidden && node.querySelectorAll('li').length > 0), 'la lista de eventos es el contenido');
  await shot(fallback.page, '10-sin-webgl.png');
  await fallback.page.close();

  // 4. Movimiento reducido + eventos privados.
  console.log('\n[prefers-reduced-motion + ?private=1]');
  const reduced = await open({ width: 1280, height: 800 }, { 'reduced-motion': '1', private: '1' });
  await reduced.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sleep(2500);
  const total = await reduced.page.$eval('.hud__counter', (node) => node.textContent);
  console.log(`  ·   contador con privados: ${total}`);
  check((await visibleNodes(reduced.page)).length > 0, 'la escena se coloca sin animación de entrada');
  await shot(reduced.page, '11-movimiento-reducido.png');
  check(reduced.errors.length === 0, `sin errores de consola (movimiento reducido)${reduced.errors.length ? `: ${reduced.errors.join(' | ')}` : ''}`);
  await reduced.page.close();

  // 5. Modo historia: entrar, dos pasos y una tarjeta de capítulo.
  console.log('\n[modo historia 1440×900]');
  const tour = await open({ width: 1440, height: 900 });
  await sleep(settleMs);
  const storyButton = await tour.page.$('#story-toggle:not([hidden])');
  if (!storyButton) {
    console.log('  ·   los datos no tienen story.path: sin modo historia');
  } else {
    const story = () => tour.page.evaluate(() => window.__timelineDebug.story());
    const cardVisible = () => tour.page.$eval('#chapter', (node) => !node.hidden);
    await storyButton.click();
    await sleep(3500);
    const first = await story();
    check(first.active && /^1 \/ \d+$/.test(first.step ?? ''), `«Ver la historia» entra en el recorrido (${first.step})`);
    check(await tour.page.$eval('#popup', (node) => !node.hidden), 'el pop-up acompaña cada paso');
    console.log(`  ·   tarjeta de capítulo al entrar: ${(await cardVisible()) ? 'sí' : 'no (el primer paso no tiene arco)'}`);
    await shot(tour.page, '12-historia-inicio.png');
    await tour.page.keyboard.press('ArrowRight');
    await sleep(4500);
    check(/^2 \//.test((await story()).step ?? ''), '→ avanza al paso 2 del recorrido');
    await shot(tour.page, '13-historia-paso-2.png');
    await tour.page.keyboard.press('ArrowRight');
    await sleep(4500);
    check(/^3 \//.test((await story()).step ?? ''), '→ avanza al paso 3 del recorrido');
    await shot(tour.page, '14-historia-paso-3.png');
    const total = Number(((await story()).step ?? '0 / 0').split('/')[1]);
    let chapter = await cardVisible();
    for (let i = 3; i < total && !chapter; i += 1) {
      await tour.page.keyboard.press('ArrowRight');
      await sleep(2500);
      chapter = await cardVisible();
    }
    if (chapter) {
      await sleep(2500);
      await shot(tour.page, '15-historia-capitulo.png');
      await tour.page.click('#chapter .chapter__continue');
      await sleep(400);
      check(!(await cardVisible()), '«Continuar» pasa la tarjeta de capítulo');
    } else {
      console.log('  ·   ningún paso abre capítulo (sin arcs)');
    }
    await tour.page.keyboard.press('Escape');
    await sleep(800);
    check(!(await story()).active, 'Esc sale del modo historia');
    await shot(tour.page, '16-historia-salida.png');
  }
  check(tour.errors.length === 0, `sin errores de consola (historia)${tour.errors.length ? `: ${tour.errors.join(' | ')}` : ''}`);
  await tour.page.close();
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} comprobación(es) fallida(s).` : '\nTodo correcto.');
process.exit(failures.length ? 1 : 0);
