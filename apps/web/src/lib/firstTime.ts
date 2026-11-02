/** Avisos que só aparecem à primeira vez (guardados neste aparelho; sem armazenamento, voltam a aparecer). */
export function firstTime(key: string): boolean {
  try {
    const k = `txill.tip.${key}`;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, '1');
    return true;
  } catch {
    return true;
  }
}

/** Já foi mostrado? (não marca) */
export function seenTip(key: string): boolean {
  try {
    return !!localStorage.getItem(`txill.tip.${key}`);
  } catch {
    return false;
  }
}
