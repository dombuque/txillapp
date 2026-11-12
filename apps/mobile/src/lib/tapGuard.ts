/**
 * Toques repetidos que não podem fazer a mesma coisa duas vezes.
 *
 * `createTapGuard`: dois toques rápidos no mesmo cartão abriam a publicação duas vezes (dois ecrãs iguais na pilha, e era
 * preciso voltar atrás duas vezes). O guarda deixa passar o primeiro e ignora os seguintes para o mesmo destino durante
 * `ms`. Destinos diferentes passam sempre (tocar no autor logo depois de tocar na foto não fica bloqueado).
 *
 * `createOnce`: uma ação que só pode correr uma vez (fechar o ecrã com um gesto que dispara vários eventos seguidos).
 */
export function createTapGuard(ms = 700, now: () => number = Date.now) {
  let last = '';
  let at = -Infinity;
  return (key: string): boolean => {
    const t = now();
    if (key === last && t - at < ms) return false;
    last = key;
    at = t;
    return true;
  };
}

export function createOnce() {
  let done = false;
  return {
    run(fn: () => void): boolean {
      if (done) return false;
      done = true;
      fn();
      return true;
    },
    reset() { done = false; },
    get done() { return done; },
  };
}

/** O guarda partilhado das publicações (o mesmo para o feed, o perfil e a pesquisa: é um só ecrã à frente de cada vez). */
export const navTap = createTapGuard();
