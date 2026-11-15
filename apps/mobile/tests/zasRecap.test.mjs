// O resumo semanal dos Zás e os Zás guardados só para mim (7 dias): as contas e os textos (src/components/zas/zasRecapLogic.ts)
// e onde entram na app («Os meus Zás», o ecrã do resumo, a rota /zas-resumo, a notificação, as Definições e a Ajuda).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'zas', 'zasRecapLogic.ts')).href);
const idx = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'settingsIndex.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const NOW = Date.parse('2026-11-15T10:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();

test('guardado vs ativo: só `active: false` é guardado (servidor antigo, sem `active`, é ativo)', () => {
  assert.equal(m.isKept({ active: false }), true);
  assert.equal(m.isKept({ active: true }), false);
  assert.equal(m.isKept({}), false);
});

test('a marca da grelha: horas no ativo, «Só tu · N dias» no guardado', () => {
  assert.equal(m.gridBadge({ active: true, expiresAt: iso(NOW + 5 * H) }, NOW), '5h');
  assert.equal(m.gridBadge({ active: true, expiresAt: iso(NOW + 10 * 60_000) }, NOW), '1h');
  assert.equal(m.gridBadge({ active: false, keepUntil: iso(NOW + 6 * D - H), expiresAt: iso(NOW - D) }, NOW), 'Só tu · 6 dias');
  assert.equal(m.gridBadge({ active: false, keepUntil: iso(NOW + 3 * H), expiresAt: iso(NOW - D) }, NOW), 'Só tu · 1 dia');
  // Sem keepUntil, conta até ao fim das 24 h (nunca «0 dias»).
  assert.equal(m.gridBadge({ active: false, keepUntil: null, expiresAt: iso(NOW - H) }, NOW), 'Só tu · 1 dia');
});

test('dias que faltam: arredondado para cima e pelo menos 1', () => {
  assert.equal(m.daysLeft(iso(NOW + 2 * D + 1), NOW), 3);
  assert.equal(m.daysLeft(iso(NOW + 2 * D), NOW), 2);
  assert.equal(m.daysLeft(iso(NOW - D), NOW), 1);
  assert.equal(m.daysText(1), '1 dia');
  assert.equal(m.daysText(4), '4 dias');
});

test('a linha do visor de um guardado: só tu vês e quando se apaga', () => {
  const k = (ms) => ({ active: false, keepUntil: iso(NOW + ms), expiresAt: iso(NOW - D) });
  assert.equal(m.keptViewerLine(k(5 * H), NOW), 'só tu vês · apaga-se hoje');
  assert.equal(m.keptViewerLine(k(30 * H), NOW), 'só tu vês · apaga-se amanhã');
  assert.equal(m.keptViewerLine(k(4 * D + H), NOW), 'só tu vês · apaga-se daqui a 5 dias');
});

test('datas na hora de Moçambique (UTC+2)', () => {
  // 22:30 UTC de sábado já é domingo em Maputo.
  assert.equal(m.longDay('2026-11-21T22:30:00Z'), '22 de novembro');
  assert.equal(m.shortDay('2026-11-21T22:30:00Z'), 'dom, 22 nov');
  assert.equal(m.shortDay('2026-11-10T08:00:00Z'), 'ter, 10 nov');
  assert.equal(m.longDay('2026-01-03T12:00:00Z'), '3 de janeiro');
});

test('o resumo: título, linha do cartão e a linha de privacidade', () => {
  const r = { label: '8–15 nov', count: 12, expiresAt: '2026-11-22T20:00:00Z', published: null };
  assert.equal(m.recapTitle(r), 'Resumo dos Zás · 8–15 nov');
  assert.equal(m.recapLine(r), '8–15 nov · 12 Zás');
  assert.equal(m.recapPrivacyLine(r), 'Só tu vês isto até o partilhares. Apaga-se a 22 de novembro.');
  assert.equal(m.recapPrivacyLine({ ...r, published: { audience: 'close_friends' } }), 'Está nos teus mimos (Amigos próximos). O resumo apaga-se a 22 de novembro.');
  assert.equal(m.recapPrivacyLine({ ...r, published: { audience: 'all' } }), 'Está nos teus mimos (Amigos). O resumo apaga-se a 22 de novembro.');
  assert.equal(m.audienceLabel('all'), 'Amigos');
  assert.equal(m.audienceLabel('close_friends'), 'Amigos próximos');
});

test('«Os meus Zás»: cartão com resumo; sem resumo, a linha só com a definição ligada', () => {
  const r = { id: 'r1' };
  assert.equal(m.recapSlot(true, r), 'card');
  assert.equal(m.recapSlot(false, r), 'card');
  assert.equal(m.recapSlot(true, null), 'hint');
  assert.equal(m.recapSlot(false, null), null);
  assert.equal(m.recapSlot(undefined, undefined), null); // servidor antigo
  assert.equal(m.RECAP_HINT, 'O teu resumo chega ao domingo à noite');
  assert.match(m.emptyText(true), /7 dias/);
  assert.equal(m.emptyText(false), 'Não tens Zás ativos. Os Zás duram 24 h.');
  assert.equal(m.emptyText(undefined), 'Não tens Zás ativos. Os Zás duram 24 h.');
});

test('a introdução do Zás diz 7 dias para ti só com a definição ligada', () => {
  assert.equal(m.introDuration(false), 'Dura 24 horas.');
  assert.equal(m.introDuration(undefined), 'Dura 24 horas.');
  assert.match(m.introDuration(true), /24 horas.*7 dias/);
});

test('apagar: o guardado diz «Apaga já o Zás guardado»', () => {
  assert.equal(m.deleteTexts({ active: false }).menu, 'Apaga já o Zás guardado.');
  assert.equal(m.deleteTexts({ active: false }).title, 'Apagar o Zás guardado?');
  assert.equal(m.deleteTexts({ active: true }).menu, 'Desaparece para toda a gente.');
  assert.equal(m.deleteTexts({}).title, 'Apagar o Zás?');
});

test('notificação zas_recap: texto, linha de baixo e destino', () => {
  assert.equal(m.RECAP_NOTICE, 'O teu resumo dos Zás da semana está pronto 🎉');
  assert.equal(m.recapNoticeSub({ label: '8–15 nov', count: 12 }), '8–15 nov · 12 Zás');
  assert.equal(m.recapNoticeSub({ label: '8–15 nov' }), '8–15 nov');
  assert.equal(m.recapNoticeSub({}), undefined);
  assert.equal(m.recapNoticeTarget({ recapId: 'abc' }), '/zas-resumo?id=abc');
  assert.equal(m.recapNoticeTarget({}), '/zas-resumo');
});

test('publicar: 409 = já está nos mimos; e o cartão 9:16 cabe na área', () => {
  assert.equal(m.publishErrorText(409), 'Este resumo já está nos teus mimos.');
  assert.equal(m.publishErrorText(404), 'Este resumo já não existe.');
  assert.equal(m.publishErrorText(500, 'Ups'), 'Ups');
  assert.deepEqual(m.recapCardSize(350, 538), { w: 302, h: 537 });
  assert.deepEqual(m.recapCardSize(300, 2000), { w: 300, h: 533 });
  const s = m.recapCardSize(703, 796);
  assert.ok(s.h <= 796 && s.w <= 703 && Math.abs(s.w / s.h - 9 / 16) < 0.01, JSON.stringify(s));
});

test('a desligar a definição, a pergunta diz o que se apaga logo', () => {
  assert.match(m.KEEP_OFF_PROMPT.message, /24 horas/);
  assert.match(m.KEEP_OFF_PROMPT.message, /resumo por partilhar apagam-se já/);
  const priv = read('app', 'settings', 'privacidade.tsx');
  assert.match(priv, /anchor="zasKeep"/);
  assert.match(priv, /queryKey: \['zas-settings'\]/);
  assert.match(priv, /KEEP_OFF_PROMPT\.title/);
});

test('a app usa o arquivo, o ecrã do resumo e a rota', () => {
  const inst = read('components', 'Instants.tsx');
  assert.match(inst, /instantsApi\.archive\(username\)/);
  assert.doesNotMatch(inst, /instantsApi\.of\(username\)/);
  assert.match(inst, /<ZasRecapView initial=\{recapOpen\}/);
  const geleira = read('lib', 'api.geleira.ts');
  assert.match(geleira, /raw\('\/instants\/archive'\)/);
  assert.match(geleira, /e\.status === 404/);
  assert.ok(existsSync(path.join(ROOT, 'src', 'app', 'zas-resumo.tsx')));
  assert.match(read('app', 'zas-resumo.tsx'), /<ZasRecapView id=/);
  const view = read('components', 'zas', 'ZasRecap.tsx');
  for (const t of ['Partilhar nos mimos', 'Partilhado nos mimos', 'Está nos teus mimos', 'Este resumo já não existe', 'Guardar', 'Partilhar']) assert.ok(view.includes(t), t);
  assert.match(view, /NameWithBadge/);
  const img = read('components', 'zas', 'zasImage.ts');
  assert.match(img, /`\/instants\/recaps\/\$\{it\.id\}\/download`/);
  assert.match(img, /txillapp-resumo-zas-/);
});

test('notificação e definições: o tipo novo, a categoria `zas` e a pesquisa', () => {
  const notif = read('app', 'notifications.tsx');
  assert.match(notif, /case 'zas_recap': return \{ text: RECAP_NOTICE/);
  assert.match(notif, /case 'zas_recap': return recapNoticeTarget/);
  assert.match(read('lib', 'api.ts'), /\| 'zas_recap'/);
  assert.deepEqual(idx.NOTIFY_LABELS.zas, ['Resumo dos Zás', 'Ao domingo à noite, quando o teu resumo da semana fica pronto']);
  assert.match(read('components', 'settings', 'device.tsx'), /c === 'zas' \? 'bolt'/);
  const first = (q) => idx.searchSettings(q)[0]?.id;
  assert.equal(first('guardar os meus zas para o resumo semanal'), 'zasKeep');
  assert.equal(first('7 dias zás'), 'zasKeep');
  assert.equal(first('resumo dos zás'), 'notify-zas');
  assert.ok(idx.searchSettings('recap').some((h) => h.id === 'zasKeep'));
  assert.equal(idx.settingsEntry('zasKeep').group, 'privacidade');
  const help = read('app', 'help.tsx');
  assert.match(help, /O que é o resumo semanal dos Zás\?/);
  assert.match(help, /para ti ficam 7 dias/);
});
