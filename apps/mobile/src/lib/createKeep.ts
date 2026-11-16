/**
 * O que se está a criar fica guardado um bocado: o modo de Criar (Mimo, Publicação, Tcheka, Zás, Txillada) e o que já se
 * escreveu no ecrã de preparar a Txillada (título, tipo, preço, meta e para quê). No iPhone a app instalada (PWA) recarrega
 * quando volta à vista com uma versão nova (register-sw.js) ou quando o sistema a tirou da memória (a câmara pesa); uma
 * mudança de tamanho grande (rodar um tablet) também volta a montar o ecrã. Antes disso, Criar voltava sempre ao Mimo e
 * o que se tinha escrito perdia-se. Agora volta onde estava, durante KEEP_MS; depois disso abre no Mimo, como sempre.
 *
 * Contas puras (sem React nem armazenamento), testadas em tests/createKeep.test.mjs. Quem usa: app/(tabs)/new.tsx e
 * components/txillada/TxilladaPrep.tsx (o armazenamento: localStorage na web, memória no telemóvel).
 */

import type { TxilladaKind } from '@/lib/txillada';

/** Quanto tempo o modo e o rascunho do preparar ficam guardados (depois de 30 minutos parados, Criar abre no Mimo). */
export const KEEP_MS = 30 * 60_000;
export const MODE_KEY = 'tx_create_mode';
export const PREP_KEY = 'tx_txillada_prep';

/** Os modos de Criar que se podem retomar. */
export const CREATE_MODES = ['mimo', 'post', 'tcheka', 'zas', 'txillada'] as const;

export type PrepForm = { title: string; kind: TxilladaKind; closeOnly: boolean; price: string; fund: boolean; goal: string; purpose: string };
export const EMPTY_PREP: PrepForm = { title: '', kind: 'public', closeOnly: false, price: '', fund: false, goal: '', purpose: '' };

/** Os mesmos limites do ecrã (lib/txillada: TITLE_MAX e PURPOSE_MAX são 80; o preço até 4 dígitos, a meta até 7). */
const TITLE_LEN = 80;
const PURPOSE_LEN = 80;

/** A chave por conta (outra conta no mesmo aparelho não vê o rascunho de quem estava). */
export const keyFor = (base: string, username: string | null | undefined) => `${base}:${username || '-'}`;

/** O que se guarda: o valor e quando. */
export function encodeKeep<T>(value: T, now: number): string {
  return JSON.stringify({ v: value, at: now });
}

function open(raw: string | null | undefined, now: number): unknown {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as { v?: unknown; at?: unknown };
    if (!o || typeof o !== 'object' || typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined;
    // Velho demais, ou do futuro (o relógio mudou): não conta.
    if (now - o.at > KEEP_MS || o.at - now > 60_000) return undefined;
    return o.v;
  } catch {
    return undefined;
  }
}

/** O modo guardado, se ainda vale e é um dos que existem; senão null (abre no Mimo). */
export function decodeMode(raw: string | null | undefined, now: number): string | null {
  const v = open(raw, now);
  return typeof v === 'string' && (CREATE_MODES as readonly string[]).includes(v) ? v : null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const digits = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[^\d]/g, '').slice(0, max) : '');

/** O rascunho do preparar guardado, limpo (só o que o ecrã aceita); null se não há ou já não vale. */
export function decodePrep(raw: string | null | undefined, now: number): PrepForm | null {
  const v = open(raw, now) as Partial<Record<keyof PrepForm, unknown>> | undefined;
  if (!v || typeof v !== 'object') return null;
  const kind: TxilladaKind = v.kind === 'friends' || v.kind === 'paid' ? v.kind : 'public';
  return {
    title: str(v.title, TITLE_LEN),
    kind,
    closeOnly: v.closeOnly === true,
    price: digits(v.price, 4),
    fund: v.fund === true,
    goal: digits(v.goal, 7),
    purpose: str(v.purpose, PURPOSE_LEN),
  };
}

/** O rascunho está vazio (igual ao de partida)? Assim não se guarda nada à toa. */
export function prepIsEmpty(p: PrepForm): boolean {
  return !p.title && p.kind === 'public' && !p.closeOnly && !p.price && !p.fund && !p.goal && !p.purpose;
}

/**
 * A Txillada só sai do modo escolhido quando o servidor diz que está desligada. Enquanto a configuração ainda não chegou
 * (logo depois de recarregar), fica: antes voltava ao Mimo nesse instante e perdia-se o modo guardado.
 */
export function dropTxillada(mode: string, enabled: boolean, known: boolean): boolean {
  return mode === 'txillada' && known && !enabled;
}

/** Na memória: no telemóvel (sem localStorage) e quando o browser não deixa guardar. Vale enquanto a app está aberta. */
const memory = new Map<string, string>();
const store = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

/** Lê o que ficou guardado (nunca lança erros). */
export function keepRead(key: string): string | null {
  try {
    const v = store()?.getItem(key);
    if (v != null) return v;
  } catch { /* sem armazenamento */ }
  return memory.get(key) ?? null;
}

/** Guarda (ou apaga, com null). Fica sempre também na memória, para valer mesmo sem armazenamento. */
export function keepWrite(key: string, raw: string | null): void {
  if (raw == null) memory.delete(key);
  else memory.set(key, raw);
  try {
    const s = store();
    if (!s) return;
    if (raw == null) s.removeItem(key);
    else s.setItem(key, raw);
  } catch { /* cheio ou bloqueado: fica a memória */ }
}
