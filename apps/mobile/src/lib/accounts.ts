import { kvGet, kvSet } from './kv';

/**
 * Várias contas no mesmo aparelho: guarda-se o token de renovação de cada uma (cofre do telemóvel; localStorage na web)
 * e qual está ativa. Trocar de conta é renovar a sessão com o token dessa conta.
 */
export interface Account { username: string; displayName: string; refreshToken: string }

const KEY = 'tx_accounts';
const CUR = 'tx_account';
let cache: Account[] | null = null;
let adding = false;

async function load(): Promise<Account[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse((await kvGet(KEY)) ?? '[]') as Account[];
  } catch {
    cache = [];
  }
  return cache;
}
async function save(list: Account[]) {
  cache = list;
  await kvSet(KEY, JSON.stringify(list));
}

export const accounts = {
  list: load,
  current: async (): Promise<Account | null> => {
    const u = await kvGet(CUR);
    return (await load()).find((a) => a.username === u) ?? null;
  },
  setCurrent: (username: string) => kvSet(CUR, username),
  /** Guarda (ou atualiza) uma conta e torna-a a ativa. */
  async upsert(a: Account) {
    const list = (await load()).filter((x) => x.username !== a.username);
    await save([a, ...list]);
    await kvSet(CUR, a.username);
  },
  /** Atualiza só o token da conta ativa (depois de renovar a sessão). */
  async updateToken(username: string, refreshToken: string) {
    const list = await load();
    const i = list.findIndex((a) => a.username === username);
    if (i >= 0) {
      list[i] = { ...list[i], refreshToken };
      await save([...list]);
    }
  },
  async remove(username: string) {
    await save((await load()).filter((a) => a.username !== username));
    if ((await kvGet(CUR)) === username) await kvSet(CUR, '');
  },
  /** A seguir à conta ativa (para o duplo toque no perfil). */
  async next(): Promise<Account | null> {
    const list = await load();
    if (list.length < 2) return null;
    const u = await kvGet(CUR);
    const i = list.findIndex((a) => a.username === u);
    return list[(i + 1) % list.length];
  },
  /** "Adicionar conta": o ecrã de entrar fica acessível mesmo com sessão. */
  beginAdd: () => { adding = true; },
  endAdd: () => { adding = false; },
  isAdding: () => adding,
};
