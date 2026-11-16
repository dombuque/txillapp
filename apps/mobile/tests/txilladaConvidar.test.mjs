// «Convidar por @» na Txillada (0168, docs/txillada-contrato.md): o @ escrito, a fila de cada sugestão, os erros em palavras
// claras, o aviso na lista das notificações e as ligações no ecrã.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return { url: src(`${spec.slice(2)}.ts`), shortCircuit: true };
    return next(spec, ctx);
  },
});

const G = await import(src('lib/txilladaGuests.ts'));
const t = await import(src('lib/txillada.ts'));

const who = (username) => ({ user: { id: `id-${username}`, username, displayName: username.toUpperCase(), avatarUrl: null }, at: '2026-11-16T10:00:00.000Z' });
const state = (o = {}) => ({ ...G.guestsInit(), ...o });

test('o @ escrito: sem o @, sem espaços; só o que cabe num @', () => {
  assert.equal(G.inviteHandle('@ana'), 'ana');
  assert.equal(G.inviteHandle('  @@Ana.Maria_1 '), 'Ana.Maria_1');
  assert.equal(G.inviteHandle('ab'), null);
  assert.equal(G.inviteHandle('@'), null);
  assert.equal(G.inviteHandle('ana maria'), null);
  assert.equal(G.inviteHandle('a'.repeat(31)), null);
  assert.equal(G.inviteHandle(undefined), null);
  // O campo já mostra o @: o que se escreve fica limpo.
  assert.equal(G.inviteInput('@ana maria!'), 'anamaria');
  assert.equal(G.inviteInput('  @rui.1'), 'rui.1');
  assert.equal(G.inviteInput('x'.repeat(40)).length, 30);
});

test('cada sugestão: convidar, aceitar quem pediu, já convidado, a transmitir, sem lugar (sem olhar às maiúsculas)', () => {
  const s = state({ guests: [{ user: who('eva').user, since: '2026-11-16T10:00:00.000Z' }], requests: [who('rui')], invites: [who('Ana')] });
  assert.deepEqual(G.inviteRow(s, 'ze'), { label: 'Convidar', can: true });
  assert.deepEqual(G.inviteRow(s, 'RUI'), { label: 'Aceitar', can: true });
  assert.deepEqual(G.inviteRow(s, 'ana'), { label: 'Convidado', can: false });
  assert.deepEqual(G.inviteRow(s, 'eva'), { label: 'A transmitir', can: false });
  const full = state({ guests: ['a1', 'a2', 'a3'].map((u) => ({ user: who(u).user, since: '2026-11-16T10:00:00.000Z' })), requests: [who('rui')] });
  assert.deepEqual(G.inviteRow(full, 'ze'), { label: 'Sem lugar', can: false });
  assert.deepEqual(G.inviteRow(full, 'rui'), { label: 'Sem lugar', can: false });
  assert.deepEqual(G.inviteRow(full, 'a2'), { label: 'A transmitir', can: false });
  assert.equal(G.inviteSentText('ana'), 'Convite enviado a @ana');
});

test('os erros em palavras claras (o 404 não diz se é um bloqueio)', () => {
  assert.equal(G.inviteErrorText({ status: 404, message: 'Utilizador não encontrado' }, 'ana'), 'Não encontrámos @ana. Confirma o @ e tenta outra vez.');
  assert.equal(G.inviteErrorText({ status: 409, code: 'already_invited', message: 'x' }, 'ana'), 'Já convidaste @ana. Espera pela resposta.');
  assert.equal(G.inviteErrorText({ status: 409, extra: { code: 'already_invited' } }, 'ana'), 'Já convidaste @ana. Espera pela resposta.');
  const full = 'Já há 3 a transmitir contigo. Tira alguém para convidares outra pessoa.';
  assert.equal(G.inviteErrorText({ status: 409, code: 'guests_full', message: 'Já há 3 convidados a transmitir. Tira um para entrar outro.' }, 'ana'), full);
  assert.equal(G.inviteErrorText({ status: 409, message: 'Já há 3 convidados a transmitir. Tira um para entrar outro.' }, 'ana'), full);
  assert.equal(G.inviteErrorText({ status: 409, message: '@ana já está a transmitir.' }, 'ana'), '@ana já está a transmitir.');
  assert.equal(G.inviteErrorText({ status: 409, message: '@ana não pode ver a tua Txillada.' }, 'ana'), '@ana não pode ver a tua Txillada.');
  assert.equal(G.inviteErrorText({ status: 409 }, 'ana'), 'Não deu para convidar @ana.');
  assert.equal(G.inviteErrorText({ status: 403, message: 'Não podes convidar @ana para transmitir.' }, 'ana'), 'Não podes convidar @ana para transmitir.');
  assert.equal(G.inviteErrorText({ status: 403 }, 'ana'), 'Não podes convidar @ana para transmitir.');
  assert.match(G.inviteErrorText({ status: 429 }, 'ana'), /^Calma!/);
  assert.match(G.inviteErrorText(null, 'ana'), /Verifica a internet/);
  // Sem travessões nem emojis nos textos.
  for (const s of [G.inviteErrorText({ status: 404 }, 'a'), G.inviteErrorText({ status: 429 }, 'a'), full]) assert.doesNotMatch(s, /[—\u{1F300}-\u{1FAFF}]/u);
});

test('o aviso «convidou-te para transmitir na Txillada» na lista: o texto, por baixo, e para onde leva', () => {
  assert.equal(t.inviteNoticeText({ title: 'Bom dia Maputo' }), 'convidou-te para transmitir na Txillada: Bom dia Maputo');
  assert.equal(t.inviteNoticeText({ title: '  ' }), 'convidou-te para transmitir na Txillada');
  assert.equal(t.inviteNoticeText(null), 'convidou-te para transmitir na Txillada');
  assert.equal(t.inviteNoticeSub({ status: 'live' }), 'Entra e aceita o convite');
  assert.equal(t.inviteNoticeSub({ status: 'ended' }), 'Já acabou');
  assert.equal(t.inviteNoticeSub({ status: null }), 'Já acabou');
  assert.equal(t.inviteNoticeSub(undefined), undefined);
  assert.equal(t.noticeTarget({ txilladaId: 'a b' }), '/txillada/a%20b');
});

test('as ligações: o painel dos convidados tem «Convidar por @» com as sugestões (e o selo), e a lista das notificações conhece o aviso', () => {
  const panel = read('src/components/txillada/TxilladaGuests.tsx');
  assert.match(panel, /<InviteByAt s=\{s\} paid=\{paid\} onInvite=\{onInvite\} \/>/);
  assert.match(panel, /Convidar por @/);
  assert.match(panel, /api\.mentionSuggest\(q\)/);
  assert.match(panel, /verified: p\.verified, verifiedTier: p\.verifiedTier/);
  const screen = read('src/app/txillada/[id].tsx');
  assert.match(screen, /onInvite=\{tx\.inviteByAt\}/);
  const room = read('src/lib/txilladaRoom.ts');
  assert.match(room, /async function inviteByAt\(username: string\)/);
  assert.match(room, /inviteErrorText\(/);
  const notes = read('src/app/notifications.tsx');
  assert.match(notes, /case 'txillada_invite': return \{ text: txilladaInviteText\(n\.data\), sub: txilladaInviteSub\(n\.txillada\) \};/);
  assert.match(notes, /case 'txillada_live':\s+case 'txillada_invite': return txilladaNoticeTarget\(n\.data\);/);
  assert.match(read('src/lib/api.ts'), /\| 'txillada_invite'/);
});
