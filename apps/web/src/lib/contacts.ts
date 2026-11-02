/**
 * Encontrar amigos nos contactos do telemóvel. Os contactos nunca saem do aparelho: só se envia o resumo (SHA-256) dos emails.
 * - Android (Chrome): o seletor de contactos do sistema (a pessoa escolhe quais).
 * - iPhone e computador: não há seletor no navegador; importa-se um ficheiro de contactos (.vcf ou .csv) exportado do telemóvel.
 */
interface ContactsManager {
  select(props: string[], opts?: { multiple?: boolean }): Promise<{ email?: string[] }[]>;
}
const manager = (): ContactsManager | null => {
  const c = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return c && typeof c.select === 'function' ? c : null;
};

export const canPickContacts = () => manager() !== null;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Todos os emails (únicos, em minúsculas) de um texto de contactos (.vcf, .csv…). */
export function emailsFromText(text: string): string[] {
  return [...new Set((text.match(EMAIL) ?? []).map((e) => e.trim().toLowerCase()))].slice(0, 2000);
}

export async function pickContactEmails(): Promise<string[]> {
  const m = manager();
  if (!m) throw new Error('Este telemóvel não deixa escolher contactos pela app');
  const picked = await m.select(['email'], { multiple: true });
  return [...new Set(picked.flatMap((c) => c.email ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export async function emailsFromFile(file: File): Promise<string[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Esse ficheiro é grande demais (máximo 5 MB)');
  return emailsFromText(await file.text());
}

/** SHA-256 hexadecimal de um email (em minúsculas, sem espaços), igual ao que o servidor guarda para comparar. */
export async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashAll(emails: string[]): Promise<string[]> {
  return Promise.all(emails.map(hashEmail));
}
