/**
 * Encontrar amigos nos contactos (só na web). Os contactos nunca saem do aparelho: só se envia o resumo (SHA-256) dos emails.
 * Porta de apps/web/src/lib/contacts.ts: Android (Chrome) tem o seletor do sistema; iPhone e computador importam um ficheiro (.vcf ou .csv).
 */
interface ContactsManager { select(props: string[], opts?: { multiple?: boolean }): Promise<{ email?: string[] }[]> }
const manager = (): ContactsManager | null => {
  const c = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return c && typeof c.select === 'function' ? c : null;
};
export const canPickContacts = () => manager() !== null;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
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
export async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const hashAll = (emails: string[]) => Promise.all(emails.map(hashEmail));

/** Escolhe um ficheiro de contactos no browser (sem expor um <input> ao resto da app). */
export function chooseContactsFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.vcf,.csv,text/vcard,text/csv,text/plain';
    i.onchange = () => resolve(i.files?.[0] ?? null);
    i.oncancel = () => resolve(null);
    i.click();
  });
}
