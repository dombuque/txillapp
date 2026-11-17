/**
 * A Txillada aberta, para a app toda (como as chamadas em lib/calls/session): a sala do LiveKit, o som e o estado vivem
 * aqui, no layout raiz, e não no ecrã. Sair do ecrã para outro sítio da app (sem tocar em Sair ou no X) não desliga: quem
 * vê continua a ouvir e tem o leitor pequeno (components/txillada/TxilladaMini); o anfitrião continua ao vivo, com a pílula
 * «Estás ao vivo · Voltar». Só `closeTxillada()` (Sair, X, Terminar e o fim) desliga.
 *
 * - `openTxillada(id)`: o ecrã app/txillada/[id] abre a sessão desta Txillada (outra que estivesse aberta desliga-se).
 * - `useTxilladaSession(id)`: o que o ecrã desenha (o mesmo que o useTxillada dava), ou null enquanto a sessão arranca.
 * - `TxilladaSessionHost`: no layout raiz; liga a sala (um componente com a chave do id: outra Txillada começa do zero).
 *
 * A Txillada aberta fica lembrada (lib/txilladaMini `encodeOpen`) para, se a PWA recarregar ao voltar, se oferecer voltar.
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { keepRead, keepWrite, keyFor } from '@/lib/createKeep';
import { useAuth } from '@/lib/auth';
import { encodeOpen, OPEN_KEY, OPEN_REFRESH_MS } from '@/lib/txilladaMini';
import { KeepAwake, useTxillada } from '@/lib/txilladaRoom';

export type TxilladaSession = ReturnType<typeof useTxillada>;

let activeId: string | null = null;
let current: { id: string; tx: TxilladaSession } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** Abre (ou mantém) a sessão da Txillada `id`. */
export function openTxillada(id: string) {
  if (!id || activeId === id) return;
  activeId = id;
  current = null;
  emit();
}
/** Desliga a Txillada aberta (Sair, X, Terminar). `forget`: também deixa de a lembrar. */
export function closeTxillada(forget = true) {
  if (forget) forgetOpen();
  if (activeId === null) return;
  activeId = null;
  current = null;
  emit();
}
export const activeTxillada = () => activeId;

/** O id da Txillada aberta (ou null). */
export function useActiveTxillada(): string | null {
  return useSyncExternalStore(subscribe, () => activeId, () => activeId);
}
/** A sessão da Txillada `id`, se é a aberta e já arrancou; null enquanto não. */
export function useTxilladaSession(id: string): TxilladaSession | null {
  const c = useSyncExternalStore(subscribe, () => current, () => current);
  return c && c.id === id ? c.tx : null;
}

// ─── Lembrar a Txillada aberta ─────────────────────────────────────────────────────────────────────────────────────────
let openKey: string | null = null;
function forgetOpen() {
  if (openKey) keepWrite(openKey, null);
}
/** A chave da lembrança da conta com sessão (outra conta no mesmo aparelho não vê a de quem estava). */
export const openKeyFor = (username: string | null | undefined) => keyFor(OPEN_KEY, username);
export const readOpen = (username: string | null | undefined) => keepRead(openKeyFor(username));
export const clearOpen = (username: string | null | undefined) => keepWrite(openKeyFor(username), null);

function Session({ id }: { id: string }) {
  const tx = useTxillada(id);
  const { user } = useAuth();
  // Cada desenho publica o estado novo (antes de o ecrã se pintar).
  useLayoutEffect(() => {
    current = { id, tx };
    emit();
  });
  useEffect(() => () => {
    if (current?.id === id) {
      current = null;
      emit();
    }
  }, [id]);
  // Ligada, fica lembrada (e renova-se); acabada, esquece-se.
  const live = tx.kind === 'live' && !!tx.dto;
  const host = tx.dto?.host.username ?? '';
  const hostName = tx.dto?.host.displayName ?? host;
  const isHost = !!tx.dto?.isHost;
  useEffect(() => {
    const key = openKeyFor(user?.username);
    openKey = key;
    if (tx.kind === 'ended' || tx.kind === 'error') { keepWrite(key, null); return; }
    if (!live) return;
    const save = () => keepWrite(key, encodeOpen({ id, host, hostName, isHost }, Date.now()));
    save();
    const t = setInterval(save, OPEN_REFRESH_MS);
    const away = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') save(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', away);
    return () => {
      clearInterval(t);
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', away);
    };
  }, [id, live, host, hostName, isHost, tx.kind, user?.username]);
  return live ? <KeepAwake /> : null;
}

/** No layout raiz (com sessão): a Txillada aberta, ligada mesmo fora do ecrã dela. */
export function TxilladaSessionHost() {
  const id = useActiveTxillada();
  // Sair da conta (ou trocar de conta: a chave é o id da conta) desliga a Txillada aberta.
  useEffect(() => () => closeTxillada(false), []);
  return id ? <Session key={id} id={id} /> : null;
}
