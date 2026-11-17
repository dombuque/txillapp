/**
 * "Os teus aparelhos" (Definições): a lógica pura da lista (sem React Native, para os testes em tests/aparelhos.test.mjs).
 * O servidor manda uma linha por login, com o nome do aparelho já legível ("iPhone · Safari (app instalada)",
 * "Android · app Txillapp 1.25", "Windows · Chrome"). Nunca há IP.
 */

import { t } from '@/lib/i18n';
export interface Aparelho {
  id: string;
  device: string;
  /** Servidores novos: o tipo e se é telemóvel. Nos antigos só há `device`. */
  kind?: 'app' | 'pwa' | 'browser' | 'unknown';
  mobile?: boolean;
  firstSeen: string;
  lastUsed: string;
  current: boolean;
}

/** Este aparelho primeiro; depois do mais recente para o mais antigo. */
export function ordenarAparelhos(list: readonly Aparelho[]): Aparelho[] {
  return [...list].sort((a, b) => (a.current !== b.current ? (a.current ? -1 : 1) : new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()));
}

/** Telemóvel ou computador (para o ícone). */
export function eTelemovel(a: Pick<Aparelho, 'device' | 'mobile'>): boolean {
  return a.mobile ?? /Android|iOS|iPhone|iPad/.test(a.device);
}

const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

/** "12 nov. 2026" (ou "12 nov." no ano corrente). */
export function dataCurta(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const y = new Date(now).getFullYear();
  return `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() === y ? '' : ` ${d.getFullYear()}`}`;
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function haQuanto(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return t('há {n} min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('há {n} h', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  return t('há {count} dia', { count: d, other: 'há {count} dias' });
}

/** A linha por baixo do nome: "Entrou a 12 nov. · ativo há 5 min" (este aparelho: "Entrou a 12 nov. · em uso agora"). */
export function detalheAparelho(a: Aparelho, now = Date.now()): string {
  return `Entrou a ${dataCurta(a.firstSeen, now)} · ${a.current ? t('em uso agora') : `ativo ${haQuanto(a.lastUsed, now)}`}`;
}
