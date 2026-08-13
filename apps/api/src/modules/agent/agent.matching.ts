/**
 * Reconocimiento de lo que escribe el cliente contra los datos del comercio.
 *
 * Nadie escribe "Pizza Muzzarella (Grande)" por WhatsApp: escribe "una muza
 * grande", "2 muzarela" o "mozzarella xl". Traducir eso a una variante concreta
 * del catálogo es trabajo nuestro y no del modelo de lenguaje, por dos razones:
 * el precio y la disponibilidad tienen que salir de la base, y así el mismo
 * reconocimiento sirve igual con cualquier proveedor de IA o sin ninguno.
 */

/** Sin tildes, sin mayúsculas, sin signos: como para comparar. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Errores de tipeo frecuentes y apodos rioplatenses.
 *
 * Se resuelven acá y no con distancia de edición porque "muza" y "muzzarella"
 * no se parecen lo suficiente para ningún umbral razonable, y bajarlo haría que
 * "napolitana" matchee con cualquier cosa.
 */
const SYNONYMS: Record<string, string> = {
  muza: 'muzzarella',
  muzza: 'muzzarella',
  muzarela: 'muzzarella',
  muzzarela: 'muzzarella',
  mozzarella: 'muzzarella',
  mozarella: 'muzzarella',
  musarela: 'muzzarella',
  faina: 'faina',
  fugaza: 'fugazza',
  fugazeta: 'fugazza',
  napo: 'napolitana',
  chivi: 'chivito',
  coca: 'coca cola',
  refresco: 'refresco',
  cerve: 'cerveza',
  birra: 'cerveza',
  empanada: 'empanadas',
};

const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'sin',
  'y',
  'para',
  'por',
  'quiero',
  'quisiera',
  'dame',
  'mandame',
  'porfa',
  'porfavor',
  'favor',
  'pizza',
  'pizzas',
]);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((token) => SYNONYMS[token] ?? token)
    .flatMap((token) => token.split(' '))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Cuánto se parece lo que escribió el cliente a un nombre del catálogo.
 *
 * Devuelve 0 cuando no hay ninguna palabra en común: es preferible responder
 * "no encontré eso" a mandar a la cocina una pizza que nadie pidió.
 */
export function score(query: string, candidate: string): number {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  let hits = 0;
  for (const token of queryTokens) {
    const matched = candidateTokens.some(
      (other) =>
        other === token ||
        // Prefijo de al menos 4 letras: cubre plurales y cortes ("empanad").
        (token.length >= 4 && other.startsWith(token.slice(0, 4))) ||
        (other.length >= 4 && token.startsWith(other.slice(0, 4))),
    );
    if (matched) hits += 1;
  }

  if (hits === 0) return 0;
  // Se premia cubrir lo que el cliente dijo y se castiga que el candidato tenga
  // mucho texto extra, para que "muzzarella" no pierda contra un combo que la
  // menciona de pasada.
  return hits / queryTokens.length + hits / candidateTokens.length / 2;
}

export interface Match<T> {
  value: T;
  score: number;
}

/** Mejor coincidencia por encima del umbral, o null. */
export function bestMatch<T>(
  query: string,
  candidates: T[],
  toText: (candidate: T) => string,
  minScore = 0.5,
): Match<T> | null {
  let best: Match<T> | null = null;
  for (const candidate of candidates) {
    const value = score(query, toText(candidate));
    if (value >= minScore && (!best || value > best.score)) {
      best = { value: candidate, score: value };
    }
  }
  return best;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  media: 1,
  medio: 1,
};

/**
 * Separa "2 muzzarella grande y una coca" en pedidos con cantidad.
 *
 * Es intencionalmente conservador: si no encuentra un número, asume 1. Pedir de
 * más es un problema mucho más caro que pedir de menos, porque termina en
 * comida tirada.
 */
export interface ParsedItem {
  text: string;
  quantity: number;
}

/**
 * Muletillas con las que arranca casi cualquier pedido por WhatsApp.
 *
 * Se sacan antes de buscar la cantidad porque "quiero 2 muzzarella" tiene el
 * número en la segunda palabra, y leer sólo la primera daría 1.
 */
const LEADING_FILLER =
  /^(?:hola|buenas|che|dale|porfa|por favor|me|te|le|das|dame|mandame|traeme|ponme|quiero|quisiera|queria|necesito|va|vas|seria|serian|serian|son|es|van|pedime|anotame|sumame|agregame|agrega|suma|y)\s+/;

function stripFiller(text: string): string {
  let result = text;
  // Iterativo: "hola, quiero dos muzzarella" tiene dos muletillas seguidas.
  for (let i = 0; i < 4; i += 1) {
    const next = result.replace(LEADING_FILLER, '');
    if (next === result) break;
    result = next;
  }
  return result.trim();
}

export function parseRequestedItems(text: string): ParsedItem[] {
  const parts = normalize(text)
    .split(/\s+(?:y|mas|ademas|tambien)\s+|,|\+/)
    .map((part) => stripFiller(part.trim()))
    .filter(Boolean);

  const items: ParsedItem[] = [];
  for (const part of parts) {
    const words = part.split(' ');
    let quantity = 1;
    let rest = part;

    const first = words[0] ?? '';
    const asDigit = Number.parseInt(first, 10);
    if (Number.isInteger(asDigit) && asDigit > 0 && asDigit <= 50) {
      quantity = asDigit;
      rest = words.slice(1).join(' ');
    } else if (NUMBER_WORDS[first] !== undefined) {
      quantity = NUMBER_WORDS[first];
      rest = words.slice(1).join(' ');
    }

    rest = rest.replace(/^x\s*/, '').trim();
    if (rest.length >= 3) items.push({ text: rest, quantity });
  }

  return items;
}
