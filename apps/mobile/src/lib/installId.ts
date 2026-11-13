import { kvGet, kvSet } from './kv';
import { isInstallId, newInstallId } from './humanCheck';

const KEY = 'tx_install_id';

/** Bytes aleatórios: os do sistema quando há (browser, Hermes recente); senão o Math.random chega (o id não é segredo). */
function random(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

let cached: Promise<string | null> | null = null;

/**
 * O identificador desta instalação (cabeçalho X-Install-Id): um valor aleatório criado na primeira vez e guardado no
 * aparelho (cofre do telemóvel ou localStorage). Não é o número do telemóvel nem nada do aparelho: serve só para o servidor
 * ver muitas contas criadas na mesma instalação. Apagar a app (ou os dados do site) cria outro.
 */
export function installId(): Promise<string | null> {
  return (cached ??= (async () => {
    try {
      const got = await kvGet(KEY);
      if (isInstallId(got)) return got;
      const id = newInstallId(random);
      await kvSet(KEY, id);
      return id;
    } catch {
      return null;
    }
  })());
}
