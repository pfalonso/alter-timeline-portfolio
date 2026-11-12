import { PartialDate } from '../model/PartialDate';

type Rec = Record<string, unknown>;
type Add = (path: string, message: string) => void;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRESENT = 'present';

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RawEventInfo {
  readonly index: number;
  readonly id: string;
  readonly branch: string;
  readonly start: PartialDate | null;
  /** Fin del periodo (año decimal, final incluido); `Infinity` si sigue en curso o está activo. */
  readonly end: number;
  readonly branchFrom?: string;
  readonly alsoBranches: unknown;
}

/** Vida de una línea: [nacimiento, fin] en años decimales, más sus pausas (abiertas en los extremos). */
interface LineLife {
  readonly birth: number;
  readonly birthLabel?: string;
  readonly end: number;
  readonly endLabel: string;
  readonly pauses: readonly { from: number; to: number; label: string }[];
}

/**
 * Reglas de vida de las líneas: nodos de unión (`alsoBranches`), «caminos que no fueron»
 * (`ghost`) y pausas (`pauses`). Una línea solo puede pasar por un nodo si está viva en su fecha:
 * ya ha nacido (`origin` o `branchFrom`), no se ha fusionado, no ha terminado (último evento, salvo
 * `until: "present"`, un evento en curso o activo) y no está en pausa. Acumula los errores con ruta.
 */
export function validateLineLife(input: Rec, mainBranch: string, add: Add): void {
  const events = collectEvents(input.events, mainBranch);
  const byId = new Map(events.map((event) => [event.id, event]));
  const lines = Array.isArray(input.branches) ? input.branches.filter(isRecord) : [];
  const declared = new Map(lines.filter((line) => typeof line.id === 'string').map((line) => [line.id as string, line]));
  const used = new Set(events.map((event) => event.branch));
  const existing = new Set([...used, ...declared.keys(), mainBranch]);

  if (Array.isArray(input.branches)) {
    input.branches.forEach((line, index) => {
      if (!isRecord(line) || typeof line.id !== 'string') return;
      validateGhost(line, `branches[${index}]`, used, add);
      validatePauses(line, `branches[${index}]`, events, byId, add);
    });
  }

  const lives = new Map<string, LineLife>();
  const lifeOf = (id: string): LineLife => {
    let life = lives.get(id);
    if (!life) {
      life = computeLife(id, declared.get(id), mainBranch, events, byId);
      lives.set(id, life);
    }
    return life;
  };

  for (const event of events) {
    const also = event.alsoBranches;
    if (also === undefined) continue;
    const path = `events[${event.index}].alsoBranches`;
    if (!Array.isArray(also)) {
      add(path, 'debe ser una lista de ids de líneas');
      continue;
    }
    const seen = new Set<string>();
    also.forEach((id: unknown, j) => {
      const at = `${path}[${j}]`;
      if (typeof id !== 'string' || !KEBAB.test(id)) return add(at, 'debe ser el id de una línea en kebab-case');
      if (!existing.has(id)) return add(at, `la línea "${id}" no existe`);
      if (id === event.branch) return add(at, `"${id}" es la línea dueña del evento: no se repite en alsoBranches`);
      if (seen.has(id)) return add(at, `"${id}" está repetida`);
      seen.add(id);
      if (declared.get(id)?.ghost === true) return add(at, `"${id}" es un camino que no fue (ghost): no pasa por otros nodos`);
      if (!event.start) return;
      const reason = deadReason(lifeOf(id), event.start.toDecimalYear());
      if (reason) add(at, `la línea "${id}" no está viva en ${event.start.toString()}: ${reason}`);
    });
  }
}

function collectEvents(raw: unknown, mainBranch: string): RawEventInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: RawEventInfo[] = [];
  raw.forEach((event, index) => {
    if (!isRecord(event) || typeof event.id !== 'string') return;
    const date = isRecord(event.date) ? event.date : {};
    const start = PartialDate.tryParse(date.start);
    const endDate = date.end === PRESENT ? null : PartialDate.tryParse(date.end);
    const ongoing = date.end === PRESENT || event.active === true;
    out.push({
      index,
      id: event.id,
      branch: typeof event.branch === 'string' ? event.branch : mainBranch,
      start,
      end: ongoing ? Infinity : (endDate ?? start)?.toDecimalYearEnd() ?? -Infinity,
      branchFrom: typeof event.branchFrom === 'string' ? event.branchFrom : undefined,
      alsoBranches: event.alsoBranches,
    });
  });
  return out;
}

function computeLife(
  id: string,
  line: Rec | undefined,
  mainBranch: string,
  events: readonly RawEventInfo[],
  byId: ReadonlyMap<string, RawEventInfo>,
): LineLife {
  const own = events.filter((event) => event.branch === id);
  const yearOf = (eventId: unknown): { year: number; label: string } | null => {
    const event = typeof eventId === 'string' ? byId.get(eventId) : undefined;
    return event?.start ? { year: event.start.toDecimalYear(), label: `nace en "${event.id}" (${event.start.toString()})` } : null;
  };
  // También la central puede nacer en un nodo (`origin`): `mainBranch` es la línea del foco actual.
  const birth = yearOf(line?.origin) ?? (id === mainBranch ? null : yearOf(own.find((event) => event.branchFrom)?.branchFrom));
  const merge = isRecord(line?.mergeInto) ? yearOf(line.mergeInto.event) : null;
  let end = Infinity;
  let endLabel = '';
  if (merge) {
    end = merge.year;
    endLabel = `se fusiona en "${String((line?.mergeInto as Rec).event)}"`;
  } else if (id !== mainBranch && line?.until !== PRESENT && own.length > 0) {
    end = Math.max(...own.map((event) => event.end));
    endLabel = 'ya ha terminado (su último evento es anterior; usa until: "present" si sigue viva)';
  }
  const pauses = (Array.isArray(line?.pauses) ? line.pauses : []).flatMap((pause: unknown) => {
    if (!isRecord(pause)) return [];
    const from = yearOf(pause.from);
    const to = yearOf(pause.to);
    return from && to ? [{ from: from.year, to: to.year, label: `está en pausa entre "${String(pause.from)}" y "${String(pause.to)}"` }] : [];
  });
  return { birth: birth?.year ?? -Infinity, birthLabel: birth?.label, end, endLabel, pauses };
}

function deadReason(life: LineLife, year: number): string | null {
  if (year < life.birth) return `aún no ha nacido (${life.birthLabel ?? ''})`;
  if (year > life.end) return life.endLabel;
  const pause = life.pauses.find((item) => year > item.from && year < item.to);
  return pause ? pause.label : null;
}

function validateGhost(line: Rec, path: string, used: ReadonlySet<string>, add: Add): void {
  if (line.ghost === undefined) return;
  if (typeof line.ghost !== 'boolean') return add(`${path}.ghost`, 'debe ser true o false');
  if (!line.ghost) return;
  if (line.origin === undefined) add(`${path}.ghost`, 'un camino que no fue necesita origin (el evento donde nace)');
  if (used.has(line.id as string)) add(`${path}.ghost`, `un camino que no fue no tiene eventos propios, pero algún evento usa la línea "${String(line.id)}"`);
  for (const key of ['until', 'mergeInto', 'pauses']) {
    if (line[key] !== undefined) add(`${path}.${key}`, `un camino que no fue (ghost) no admite ${key}`);
  }
}

function validatePauses(
  line: Rec,
  path: string,
  events: readonly RawEventInfo[],
  byId: ReadonlyMap<string, RawEventInfo>,
  add: Add,
): void {
  const pauses = line.pauses;
  if (pauses === undefined || line.ghost === true) return;
  if (!Array.isArray(pauses)) return add(`${path}.pauses`, 'debe ser una lista de pausas { from, to }');
  const valid: { from: number; to: number; at: string; ids: [string, string] }[] = [];
  pauses.forEach((pause: unknown, j) => {
    const at = `${path}.pauses[${j}]`;
    if (!isRecord(pause)) return add(at, 'debe ser un objeto { from, to }');
    const ends: (RawEventInfo | null)[] = (['from', 'to'] as const).map((key) => {
      const id = pause[key];
      if (typeof id !== 'string' || id.trim() === '') {
        add(`${at}.${key}`, 'es obligatorio y debe ser el id de un evento');
        return null;
      }
      const event = byId.get(id);
      if (!event) add(`${at}.${key}`, `el evento "${id}" no existe`);
      return event ?? null;
    });
    const [from, to] = ends;
    if (!from?.start || !to?.start) return;
    if (to.start.compareTo(from.start) <= 0) {
      return add(`${at}.to`, `"${to.id}" (${to.start.toString()}) debe ser posterior a "${from.id}" (${from.start.toString()})`);
    }
    valid.push({ from: from.start.toDecimalYear(), to: to.start.toDecimalYear(), at, ids: [from.id, to.id] });
  });
  valid.sort((a, b) => a.from - b.from);
  for (let k = 1; k < valid.length; k += 1) {
    if (valid[k].from < valid[k - 1].to) add(valid[k].at, `se solapa con la pausa "${valid[k - 1].ids.join(' → ')}"`);
  }
  for (const pause of valid) {
    for (const event of events) {
      if (event.branch !== line.id || !event.start || pause.ids.includes(event.id)) continue;
      const year = event.start.toDecimalYear();
      if (year > pause.from && year < pause.to) {
        add(pause.at, `el evento "${event.id}" (${event.start.toString()}) de la línea cae dentro de la pausa`);
      }
    }
  }
}
