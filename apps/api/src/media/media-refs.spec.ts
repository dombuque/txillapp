import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { JSON_WITHOUT_MEDIA, MEDIA_COLUMN_REFS, MEDIA_JSON_REFS, referencedSql } from './media-refs';

/**
 * Salvaguarda da limpeza dos envios por publicar: lê todas as migrações e confere que cada coluna que guarda o id de um
 * ficheiro (`*_media_id`, `media_id` ou que referencie content.media_assets) está em MEDIA_COLUMN_REFS, e que cada coluna
 * jsonb está em MEDIA_JSON_REFS ou em JSON_WITHOUT_MEDIA. Uma coluna nova fora da lista faria a limpeza apagar ficheiros em uso.
 */
const DIR = join(__dirname, '../../migrations');

interface Col { table: string; column: string; file: string }

/** As colunas que as migrações criam (e não voltam a tirar), com a tabela de cada uma. */
function columnsFromMigrations() {
  const media = new Map<string, Col>();
  const json = new Map<string, Col>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
    let table: string | null = null;
    for (const raw of sql.split('\n')) {
      const line = raw.replace(/--.*$/, '');
      // A tabela de que se fala: CREATE TABLE x ( … ) ou ALTER TABLE x (as colunas podem vir nas linhas seguintes).
      const t = /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?)\s+([a-z_]+\.[a-z_]+)/i.exec(line);
      if (t) table = t[1].toLowerCase();
      if (!table) continue;
      const tail = t ? line.slice(t.index + t[0].length) : line;
      for (const m of tail.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_]+)/gi)) {
        media.delete(`${table}.${m[1].toLowerCase()}`);
        json.delete(`${table}.${m[1].toLowerCase()}`);
      }
      // Definições de colunas: «nome tipo …» no princípio da linha (CREATE TABLE) ou depois de ADD COLUMN.
      const defs = [...tail.matchAll(/(?:^\s*\(?\s*|ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)([a-z_]+)\s+(uuid(?:\[\])?|jsonb)\b([^,]*)/gi)];
      for (const d of defs) {
        const column = d[1].toLowerCase();
        const type = d[2].toLowerCase();
        const rest = d[3] ?? '';
        if (['constraint', 'primary', 'unique', 'check', 'foreign'].includes(column)) continue;
        const key = `${table}.${column}`;
        if (type === 'jsonb') json.set(key, { table, column, file });
        else if (/media_ids?$/.test(column) || /REFERENCES\s+content\.media_assets\b/i.test(rest)) media.set(key, { table, column, file });
      }
    }
  }
  return { media, json };
}

describe('lista das referências aos ficheiros (envios por publicar)', () => {
  const { media, json } = columnsFromMigrations();

  it('a leitura das migrações encontra as colunas conhecidas', () => {
    // Se isto falhar, foi o leitor das migrações que deixou de as entender (e o resto do teste deixava de proteger).
    for (const k of ['content.post_media.media_id', 'identity.users.avatar_media_id', 'content.sounds.audio_media_id', 'content.compose_jobs.media_id', 'identity.verification_requests.doc_media_id']) expect(media.has(k)).toBe(true);
    for (const k of ['content.posts.music', 'content.compose_jobs.spec', 'content.stories.stickers']) expect(json.has(k)).toBe(true);
    // posts.media_id existiu (0002) e saiu em 0004, para content.post_media.
    expect(media.has('content.posts.media_id')).toBe(false);
  });

  it('cada coluna com o id de um ficheiro está em MEDIA_COLUMN_REFS', () => {
    const listed = new Set(MEDIA_COLUMN_REFS.map((r) => `${r.table}.${r.column}`));
    const missing = [...media.values()].filter((c) => !listed.has(`${c.table}.${c.column}`)).map((c) => `${c.table}.${c.column} (${c.file})`);
    expect(missing).toEqual([]);
  });

  it('cada coluna jsonb está em MEDIA_JSON_REFS ou em JSON_WITHOUT_MEDIA', () => {
    const listed = new Set([...MEDIA_JSON_REFS.map((r) => `${r.table}.${r.column}`), ...Object.keys(JSON_WITHOUT_MEDIA)]);
    const missing = [...json.values()].filter((c) => !listed.has(`${c.table}.${c.column}`)).map((c) => `${c.table}.${c.column} (${c.file})`);
    expect(missing).toEqual([]);
  });

  it('a lista não tem colunas que as migrações não criam (um engano no nome deixava um uso por ver)', () => {
    const extraCols = MEDIA_COLUMN_REFS.map((r) => `${r.table}.${r.column}`).filter((k) => !media.has(k));
    const extraJson = [...MEDIA_JSON_REFS.map((r) => `${r.table}.${r.column}`), ...Object.keys(JSON_WITHOUT_MEDIA)].filter((k) => !json.has(k));
    expect([...extraCols, ...extraJson]).toEqual([]);
  });

  it('o SQL junta todas as referências', () => {
    const sql = referencedSql();
    for (const r of MEDIA_COLUMN_REFS) expect(sql).toContain(`FROM ${r.table} t WHERE t.${r.column} = ANY`);
    for (const r of MEDIA_JSON_REFS) expect(sql).toContain(`FROM ${r.table} t WHERE t.${r.column}->>'mediaId'`);
    expect(sql).toContain('content.compose_jobs j');
    expect(sql).toContain(`r.target_type = 'media'`);
  });
});
