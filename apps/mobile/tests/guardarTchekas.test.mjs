// Testes de «Deixar guardar as minhas tchekas» (0153) na app: o `canDownload` das publicações esconde «Guardar o vídeo»
// (src/lib/tchekaDownload.ts, usado no menu ⋯ e na folha de partilha), a mensagem da API quando recusa (403), a linha nas
// Definições → Conteúdo (desligada e bloqueada numa conta privada ou de menor) e a pesquisa das Definições.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dl = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaDownload.ts')).href);
const idx = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'settingsIndex.ts')).href);
const read = (...f) => readFileSync(path.join(ROOT, 'src', ...f), 'utf8').replace(/\r\n/g, '\n');

const tcheka = { id: 'p1', code: 'Ab3xK9q', kind: 'post', media: [{ kind: 'video' }] };

test('canDownload falso esconde a opção; sem o campo (servidor antigo, cache) continua a aparecer', () => {
  assert.equal(dl.canDownload(tcheka), true);
  assert.equal(dl.canDownload({ ...tcheka, canDownload: true }), true);
  assert.equal(dl.canDownload({ ...tcheka, canDownload: false }), false);
  assert.equal(dl.downloadTarget({ ...tcheka, canDownload: false }), null);
  // Sem vídeo continua a não dar, mesmo com canDownload.
  assert.equal(dl.canDownload({ id: 'f', kind: 'post', media: [{ kind: 'image' }], canDownload: true }), false);
});

test('num repost vale o original: a API manda o canDownload do original no repost e no original', () => {
  const blockedOriginal = { ...tcheka, canDownload: false };
  assert.equal(dl.canDownload({ id: 'r1', kind: 'repost', media: [], canDownload: false, repostOf: blockedOriginal }), false);
  // Repost em cache sem o campo, com o original já recusado: também não.
  assert.equal(dl.canDownload({ id: 'r2', kind: 'repost', media: [], repostOf: blockedOriginal }), false);
  assert.equal(dl.downloadTarget({ id: 'r3', kind: 'repost', media: [], canDownload: true, repostOf: { ...tcheka, canDownload: true } }).id, 'p1');
});

test('a recusa da API: a mensagem dela; sem corpo, uma frase de reserva', () => {
  assert.equal(dl.refusalMessage(403, { statusCode: 403, message: 'Quem publicou não deixa guardar as suas tchekas.' }), 'Quem publicou não deixa guardar as suas tchekas.');
  assert.equal(dl.refusalMessage(400, { message: ['primeira', 'segunda'] }), 'primeira');
  assert.equal(dl.refusalMessage(403, null), dl.DOWNLOAD_BLOCKED);
  assert.equal(dl.refusalMessage(403, { message: '  ' }), dl.DOWNLOAD_BLOCKED);
  assert.match(dl.refusalMessage(404, null), /já não está disponível/);
  assert.match(dl.refusalMessage(500, 'html'), /Tenta outra vez/);
  assert.equal(dl.DOWNLOAD_BLOCKED, 'Quem publicou não deixa guardar as suas tchekas.');
});

test('no telemóvel: as recusas rápidas lêem-se do erro do descarregamento (Android e iOS); o resto não', () => {
  assert.equal(dl.quickRefusal(new Error('Unable to download a file: response has status: 403')), 403);
  assert.equal(dl.quickRefusal(new Error('response has status 404')), 404);
  assert.equal(dl.quickRefusal(new Error('server returned HTTP 422')), 422);
  assert.equal(dl.quickRefusal(new Error('response has status: 503')), null);
  assert.equal(dl.quickRefusal(new Error('Network request failed')), null);
  assert.equal(dl.quickRefusal(null), null);
  assert.equal(dl.quickRefusal(new Error('id 14030')), null);
});

test('guardar mostra a mensagem da API: no telemóvel pede-a outra vez; no site o erro já a traz', () => {
  const save = read('lib', 'saveTcheka.ts');
  assert.match(save, /quickRefusal\(e\)/);
  assert.match(save, /fetchAuthed\(downloadPath\(t\)\)/);
  assert.match(save, /refusalMessage\(res\.status, await res\.json\(\)/);
  assert.match(save, /Não dá para guardar/);
  const web = read('lib', 'saveToGallery.web.ts');
  assert.match(web, /await res\.json\(\)\.catch/);
  assert.match(web, /throw new Error\(typeof msg === 'string' && msg\.trim\(\) \? msg : 'Não consegui preparar o ficheiro'\)/);
});

test('a definição: ligada por omissão; numa conta privada ou de menor desligada, bloqueada e com a razão', () => {
  assert.deepEqual(dl.downloadSetting({ allow: true, effective: true, private: false, minor: false }).on, true);
  assert.equal(dl.downloadSetting({ allow: true, effective: true, private: false, minor: false }).disabled, false);
  const off = dl.downloadSetting({ allow: false, effective: false, private: false, minor: false });
  assert.equal(off.on, false);
  assert.equal(off.disabled, false);
  assert.match(off.description, /só tu podes guardar/);
  const priv = dl.downloadSetting({ allow: true, effective: false, private: true, minor: false });
  assert.equal(priv.on, false);
  assert.equal(priv.disabled, true);
  assert.match(priv.description, /privada/);
  const minor = dl.downloadSetting({ allow: true, effective: false, private: false, minor: true });
  assert.equal(minor.on, false);
  assert.equal(minor.disabled, true);
  assert.match(minor.description, /maiores de 18 anos/);
  assert.equal(dl.downloadSetting(null).disabled, true);
});

test('Definições → Conteúdo: a linha com o interruptor, a âncora e o cliente da API', () => {
  const screen = read('app', 'settings', 'conteudo.tsx');
  assert.match(screen, /anchor="allowDownloads" icon="download" title=\{t\('Deixar guardar as minhas tchekas'\)\}/);
  assert.match(screen, /toggle=\{\{ on: dlRow\.on, disabled: dlRow\.disabled, onChange: \(v\) => void setDownloads\(v\) \}\}/);
  assert.match(screen, /queryFn: settingsApi\.downloadSettings/);
  const api = read('lib', 'api.settings.ts');
  assert.match(api, /raw\('\/posts\/me\/download-settings'\)/);
  assert.match(api, /method: 'PUT', body: JSON\.stringify\(\{ allow \}\)/);
  assert.match(read('lib', 'api.ts'), /\n  canDownload\?: boolean;/);
  assert.ok(readFileSync(path.join(ROOT, 'src', 'icons', 'tx.ts'), 'utf8').includes('"download":'));
});

test('a pesquisa das Definições encontra a opção (guardar, descarregar, download, transferir…)', () => {
  const e = idx.settingsEntry('allowDownloads');
  assert.equal(e.group, 'conteudo');
  assert.equal(e.title, 'Deixar guardar as minhas tchekas');
  const finds = (q) => idx.searchSettings(q).some((h) => h.id === 'allowDownloads');
  for (const q of ['guardar', 'guardar video', 'descarregar', 'download', 'transferir', 'baixar', 'tchekas', 'videos', 'galeria']) assert.ok(finds(q), q);
  assert.equal(idx.searchSettings('guardar video')[0].id, 'allowDownloads');
  assert.equal(idx.searchSettings('deixar guardar')[0].id, 'allowDownloads');
  assert.equal(idx.entryPath(e), '/settings/conteudo?o=allowDownloads');
  // «Guardados» continua a ser os guardados.
  assert.equal(idx.searchSettings('guardados')[0].id, 'saved');
});
