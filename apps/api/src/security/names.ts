/**
 * «Tem cara de gerado?» para o @, o nome e o email de uma conta nova. Só soma pontos de risco (nunca recusa sozinho):
 * há muita gente a sério com números no @ (ano, número da camisola). Por isso cada sinal vale pouco e o total tem teto.
 */
const VOWELS = /[aeiouy]/;

/** Pedaços de letras sem vogais muito compridos («xkqzrt»): típico de texto aleatório. */
const consonantRun = (s: string) => Math.max(0, ...(s.toLowerCase().match(/[bcdfghjklmnpqrstvwxz]+/g) ?? ['']).map((x) => x.length));

/** Muda entre letras e algarismos muitas vezes («a8k2m9»). */
const switches = (s: string) => {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (/\d/.test(s[i]) !== /\d/.test(s[i - 1])) n++;
  return n;
};

export interface NameSignals {
  points: number;
  reasons: string[];
}

export function generatedNameSignals(username: string, displayName: string, email: string): NameSignals {
  const reasons: string[] = [];
  const u = username.toLowerCase().replace(/[_.]/g, '');
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[_.+-]/g, '');
  const digits = (u.match(/\d/g) ?? []).length;
  if (/\d{5,}$/.test(u) || (u.length >= 8 && digits / u.length >= 0.5)) reasons.push('muitos números no @');
  if (switches(u) >= 4) reasons.push('@ às voltas entre letras e números');
  if (consonantRun(u) >= 6 || (u.length >= 8 && !VOWELS.test(u.replace(/\d/g, '')))) reasons.push('@ sem vogais');
  const name = displayName.trim().toLowerCase();
  if (name && (name.replace(/\s/g, '') === u || /\d{3,}/.test(name))) reasons.push('nome igual ao @ ou com números');
  if (/\d{6,}/.test(local) || consonantRun(local) >= 7) reasons.push('email com cara de gerado');
  // Dois sinais valem o máximo (20); um só vale 8.
  const points = reasons.length >= 2 ? 20 : reasons.length === 1 ? 8 : 0;
  return { points, reasons };
}
