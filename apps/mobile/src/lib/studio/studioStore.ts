/**
 * Onde o estúdio guarda os rascunhos e o registo da montagem. No site: o IndexedDB de sempre (lib/studio/drafts.ts) e o
 * registo da montagem não se usa (o site monta no próprio browser). No telemóvel: `studioStore.native.ts`.
 */
import { studioDrafts } from './drafts';
import type { JobRecord } from './composeJob';

export const studioStore = studioDrafts;

export async function loadJobRecord(_draftId: string): Promise<JobRecord | null> { return null; }
export async function saveJobRecord(_rec: JobRecord): Promise<void> { /* só no telemóvel */ }
export async function clearJobRecord(_draftId: string): Promise<void> { /* só no telemóvel */ }
/** O último registo de montagem guardado (para retomar ao abrir a app); no site não há. */
export async function latestJobRecord(): Promise<JobRecord | null> { return null; }
