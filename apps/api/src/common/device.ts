import type { IncomingHttpHeaders } from 'http';

/**
 * Aparelhos com sessão iniciada: um nome legível a partir do user agent ("iPhone · Safari (app instalada)",
 * "Android · app Txillapp 1.25", "Windows · Chrome"). Serve a lista do dono (Definições) e a ficha da conta no backoffice.
 *
 * A app nativa não tem um user agent útil (no Android é o do okhttp, no iPhone o do CFNetwork). Por isso, quando o pedido
 * traz `X-Client: txillapp-mobile`, o servidor guarda no início do user agent uma marca `TxillappApp/<versão> (<plataforma>)`.
 * A versão web da app instalada no ecrã principal manda `X-App-Display: standalone`, e o servidor acrescenta ` TxillappPWA`.
 * Nunca se guarda o endereço IP.
 */

export type DeviceKind = 'app' | 'pwa' | 'browser' | 'unknown';
export interface DeviceInfo {
  /** "iPhone · Safari (app instalada)". */
  label: string;
  kind: DeviceKind;
  /** Telemóvel ou tablet (para o ícone). */
  mobile: boolean;
}

const VERSION = /^\d{1,3}\.\d{1,3}(?:\.\d{1,4})?$/;
const PLATFORM = /^(android|ios|ipad)$/;

const one = (h: string | string[] | undefined) => (typeof h === 'string' ? h : undefined);

/** O user agent a guardar na sessão: o do pedido, com a marca da app nativa ou da app instalada (sem IP nem mais nada). */
export function sessionUserAgent(headers: IncomingHttpHeaders): string | undefined {
  const ua = (one(headers['user-agent']) ?? '').trim();
  const client = one(headers['x-client']);
  if (client === 'txillapp-mobile') {
    const v = one(headers['x-app-version'])?.trim();
    const p = one(headers['x-app-platform'])?.trim().toLowerCase();
    const mark = `TxillappApp${v && VERSION.test(v) ? `/${v}` : ''}${p && PLATFORM.test(p) ? ` (${p})` : ''}`;
    return `${mark} ${ua}`.trim().slice(0, 300);
  }
  if (client === 'txillapp-web' && one(headers['x-app-display']) === 'standalone' && ua) return `${ua.slice(0, 285)} TxillappPWA`;
  return ua ? ua.slice(0, 300) : undefined;
}

function osOf(ua: string): { os: string; mobile: boolean } {
  if (/iPad/.test(ua)) return { os: 'iPad', mobile: true };
  if (/iPhone|iPod/.test(ua)) return { os: 'iPhone', mobile: true };
  if (/Android/.test(ua)) return { os: 'Android', mobile: true };
  if (/CrOS/.test(ua)) return { os: 'Chromebook', mobile: false };
  if (/Windows/.test(ua)) return { os: 'Windows', mobile: false };
  if (/Mac OS X|Macintosh/.test(ua)) return { os: 'Mac', mobile: false };
  if (/Linux/.test(ua)) return { os: 'Linux', mobile: false };
  return { os: '', mobile: false };
}

function browserOf(ua: string): string {
  if (/Instagram/.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

/** O nome legível de um aparelho, a partir do user agent guardado na sessão. */
export function describeDevice(raw?: string | null): DeviceInfo {
  const ua = (raw ?? '').trim();
  if (!ua) return { label: 'Aparelho desconhecido', kind: 'unknown', mobile: false };

  // App nativa: com a marca (versões novas) ou pelo user agent da biblioteca de rede (versões antigas da app).
  const app = /^TxillappApp(?:\/([\d.]+))?(?: \((android|ios|ipad)\))?/.exec(ua);
  if (app || /^okhttp\//i.test(ua) || /CFNetwork\/.*Darwin\//.test(ua)) {
    const platform = app?.[2];
    const os = platform === 'android' || (!platform && /okhttp|Android/i.test(ua)) ? 'Android' : platform === 'ipad' || /iPad/.test(ua) ? 'iPad' : 'iPhone';
    const v = app?.[1]?.split('.').slice(0, 2).join('.');
    return { label: `${os} · app Txillapp${v ? ` ${v}` : ''}`, kind: 'app', mobile: true };
  }

  const pwa = / TxillappPWA$/.test(ua);
  const { os, mobile } = osOf(ua);
  const browser = browserOf(ua);
  const label = `${os ? `${os} · ` : ''}${browser}${pwa ? ' (app instalada)' : ''}`;
  return { label, kind: pwa ? 'pwa' : browser === 'Browser' && !os ? 'unknown' : 'browser', mobile };
}

/** Estado de uma sessão (família de tokens de renovação). */
export type SessionState = 'active' | 'ended' | 'expired';
