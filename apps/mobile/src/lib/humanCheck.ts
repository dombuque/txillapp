/**
 * Prova de humano (Cloudflare Turnstile) e as respostas da segurança do servidor, sem React (testado em
 * tests/humanCheck.test.mjs). O widget está em components/HumanCheck(.web).tsx.
 *
 * Só se liga com a chave do site em EXPO_PUBLIC_TURNSTILE_SITEKEY (pública; a secreta fica no servidor). Sem ela, a app
 * faz tudo como antes e o servidor decide. Se o widget falhar a carregar, o pedido segue sem código: a prova nunca pode
 * impedir quem é legítimo de entrar por um problema da Cloudflare ou da rede.
 */

/**
 * A chave do site, ou null (prova desligada). Quem chama passa `process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY` escrito assim
 * mesmo: o Expo só põe o valor na app quando a variável aparece por extenso no código.
 */
export function turnstileSiteKey(raw: string | undefined): string | null {
  const k = (raw ?? '').trim();
  return /^[A-Za-z0-9_-]{10,100}$/.test(k) ? k : null;
}

/** O identificador desta instalação (cabeçalho X-Install-Id): o formato que o servidor aceita. */
export const isInstallId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);

/** Um identificador novo: 32 caracteres aleatórios (não diz nada sobre o aparelho, só distingue esta instalação). */
export function newInstallId(random: (n: number) => Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(random(32), (b) => abc[b & 63]).join('');
}

export interface ServerError {
  status?: number;
  code?: string;
  message?: string;
}

/** O servidor pediu a prova de humano (falta o código ou falhou)? */
export const needsHumanCheck = (e: ServerError | null | undefined) => !!e && e.status === 403 && e.code === 'human_check';

/** Códigos com texto já em português, feito pelo servidor (bloqueios, limites, email temporário, conta em revisão). */
const SERVER_TEXT = new Set(['login_locked', 'login_ip_locked', 'register_limit', 'email_check_limit', 'disposable_email', 'risk_limited', 'busy']);

/**
 * O texto a mostrar no login, no registo e no «Esqueci-me da senha» para um erro do servidor.
 * `where`: no login, o 401 é «credenciais erradas».
 */
export function securityErrorText(e: ServerError | null | undefined, where: 'login' | 'register' | 'forgot'): string {
  if (!e) return 'Não deu agora. Tenta outra vez.';
  if (e.code && SERVER_TEXT.has(e.code) && e.message) return e.message;
  if (e.code === 'human_check') return 'Não conseguimos confirmar que és uma pessoa. Tenta outra vez.';
  if (e.status === 503) return 'Estamos com muita gente a entrar ao mesmo tempo. Tenta outra vez daqui a pouco.';
  // O limite geral por minuto do servidor responde em inglês («Too Many Requests»).
  if (e.status === 429) return 'Muitas tentativas seguidas. Espera um minuto e tenta outra vez.';
  if (where === 'login' && e.status === 401) return 'Hmm, essas credenciais não batem';
  return e.message || 'Não deu agora. Tenta outra vez.';
}

/** O passo do registo a que se volta: o email temporário volta ao passo do email. */
export const registerStepFor = (e: ServerError | null | undefined): 'email' | null => (e?.code === 'disposable_email' ? 'email' : null);

/** Mensagens que a página do widget (na WebView da app nativa) manda para a app. */
export type TurnstileMessage = { type: 'token'; token: string } | { type: 'error' | 'expired' | 'interactive' | 'done' | 'ready' };

export function parseTurnstileMessage(data: string): TurnstileMessage | null {
  try {
    const m = JSON.parse(data) as { type?: unknown; token?: unknown };
    if (m.type === 'token') return typeof m.token === 'string' && m.token.length >= 10 && m.token.length <= 4096 ? { type: 'token', token: m.token } : null;
    if (m.type === 'error' || m.type === 'expired' || m.type === 'interactive' || m.type === 'done' || m.type === 'ready') return { type: m.type };
    return null;
  } catch {
    return null;
  }
}

/**
 * A página do widget para a WebView da app nativa (abre com baseUrl https://txillapp.com, que é o domínio autorizado na
 * Cloudflare). O widget só aparece se a Cloudflare pedir para tocar; `window.txRun()` pede um código novo.
 */
export function turnstileHtml(siteKey: string): string {
  const key = JSON.stringify(siteKey);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;min-height:100%}</style>
</head><body><div id="w"></div>
<script>
function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
var id = null, wanted = false;
window.txRun = function(){
  wanted = true;
  if (!window.turnstile) return;
  try {
    if (id === null) id = turnstile.render('#w', { sitekey: ${key}, appearance: 'interaction-only', execution: 'execute', language: 'pt',
      callback: function(t){ post({ type: 'token', token: t }); },
      'error-callback': function(){ post({ type: 'error' }); return true; },
      'expired-callback': function(){ post({ type: 'expired' }); },
      'before-interactive-callback': function(){ post({ type: 'interactive' }); },
      'after-interactive-callback': function(){ post({ type: 'done' }); } });
    else turnstile.reset(id);
    turnstile.execute(id);
  } catch (e) { post({ type: 'error' }); }
};
window.txLoaded = function(){ post({ type: 'ready' }); if (wanted) window.txRun(); };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=txLoaded" async defer onerror="post({type:'error'})"></script>
</body></html>`;
}
