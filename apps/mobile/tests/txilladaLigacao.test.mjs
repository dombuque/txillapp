// A Txillada quando a ligação do anfitrião cai (txillada-ligacao): o motivo do fim ('lost'), o «já acabou» das ações, até
// quando se espera que o anfitrião continue, os textos, e as ligações no código (as ações do anfitrião uma de cada vez e só
// com a ligação de pé, o aviso por cima da folha dos Convidados, voltar a entrar sozinho).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return { url: new URL(`../src/${spec.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const t = await import(new URL('../src/lib/txillada.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');
const ID = '0193a2b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
const dto = (x = {}) => ({ id: ID, status: 'live', viewers: 0, peakViewers: 0, cheers: 0, comments: 0, ...x });

test('o evento txillada.ended traz o motivo (só «lost») e txillada.resumed lê-se', () => {
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: ID, status: 'ended', reason: 'lost' }, ID), { type: 'txillada.ended', txilladaId: ID, status: 'ended', reason: 'lost' });
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: ID, status: 'ended' }, ID), { type: 'txillada.ended', txilladaId: ID, status: 'ended' });
  // Um motivo desconhecido (ou num corte) não passa.
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: ID, status: 'cut', reason: 'lost' }, ID), { type: 'txillada.ended', txilladaId: ID, status: 'cut' });
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: ID, status: 'ended', reason: 'outro' }, ID), { type: 'txillada.ended', txilladaId: ID, status: 'ended' });
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.resumed', txilladaId: ID }, ID), { type: 'txillada.resumed', txilladaId: ID });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.resumed', txilladaId: 'outra' }, ID), null);
});

test('o estado: o motivo vem do evento ou da resposta já acabada; uma resposta antiga não o apaga; um corte vence', () => {
  const live = t.withDto(t.initialLive(), dto());
  assert.equal(live.endReason, null);
  const lost = t.applyEvent(live, { type: 'txillada.ended', txilladaId: ID, status: 'ended', reason: 'lost' });
  assert.equal(lost.status, 'ended');
  assert.equal(lost.endReason, 'lost');
  // Uma resposta antiga (ainda a decorrer) não volta a pôr «AO VIVO» nem tira o motivo.
  const stale = t.withDto(lost, dto({ endReason: null }));
  assert.equal(stale.status, 'ended');
  assert.equal(stale.endReason, 'lost');
  // A sala fechou (sem motivo no evento) e depois a API diz 'lost'.
  const closed = t.applyEvent(live, { type: 'txillada.ended', txilladaId: ID, status: 'ended' });
  assert.equal(closed.endReason, null);
  assert.equal(t.withDto(closed, dto({ status: 'ended', endReason: 'lost' })).endReason, 'lost');
  // Acabada cá por um 409 e a API diz que a moderação a cortou: 'cut'.
  assert.equal(t.withDto(closed, dto({ status: 'cut', endReason: null })).status, 'cut');
  // Continuada: o estado recomeça do zero com a resposta nova (o 'reopen' do txilladaRoom).
  assert.equal(t.initialLive(dto()).status, 'live');
});

test('isEndedError: 409/410 com code «ended», ou a frase dos servidores antigos', () => {
  assert.equal(t.isEndedError({ status: 409, code: 'ended', message: 'The Txillada has ended.' }), true);
  assert.equal(t.isEndedError({ status: 410, code: 'ended' }), true);
  assert.equal(t.isEndedError({ status: 409, message: 'A Txillada já acabou.' }), true);
  assert.equal(t.isEndedError({ status: 409, message: 'Já tens uma Txillada a decorrer.' }), false);
  assert.equal(t.isEndedError({ status: 429, code: 'ended' }), false);
  assert.equal(t.isEndedError(null), false);
});

test('até quando se espera que o anfitrião continue: o resumeUntil da API, ou 10 min desde o aviso', () => {
  const until = '2026-11-17T18:13:07.000Z';
  assert.equal(t.resumeDeadline(dto({ status: 'ended', endReason: 'lost', resumeUntil: until }), 'lost', 1), Date.parse(until));
  // A API já diz que passou (ou que não foi a ligação): não se espera.
  assert.equal(t.resumeDeadline(dto({ status: 'ended', endReason: 'lost', resumeUntil: null }), 'lost', 1), 0);
  assert.equal(t.resumeDeadline(dto({ status: 'ended', endReason: null, resumeUntil: null }), null, 1), 0);
  // Só o aviso em tempo real (a resposta ainda é a antiga): 10 min desde que se soube.
  assert.equal(t.resumeDeadline(dto({ status: 'live' }), 'lost', 1000), 1000 + t.RESUME_WINDOW_MS);
  // Um servidor antigo (sem endReason): conta o aviso.
  assert.equal(t.resumeDeadline(dto({ status: 'ended' }), 'lost', 1000), 1000 + t.RESUME_WINDOW_MS);
  assert.equal(t.resumeDeadline(dto({ status: 'ended' }), null, 1000), 0);
  assert.equal(t.RESUME_WINDOW_MS, 600_000);
});

test('os textos: o anfitrião (até às HH:MM) e quem vê («A ligação do anfitrião caiu»)', () => {
  const now = new Date(2026, 10, 17, 18, 3, 7).getTime();
  const until = new Date(2026, 10, 17, 18, 13, 7).toISOString();
  assert.equal(t.resumeText(until, now), 'A tua ligação caiu e a Txillada parou. Podes continuar até às 18:13.');
  assert.equal(t.resumeText(until, now + 11 * 60_000), 'A tua ligação caiu e a Txillada parou.');
  assert.equal(t.resumeText(null, now), 'A tua ligação caiu e a Txillada parou.');
  assert.deepEqual(t.endedText('lost', true), { title: 'A ligação do anfitrião caiu', sub: 'Se ele continuar, voltas a entrar sozinho.' });
  assert.equal(t.endedText('lost', false).title, 'A ligação do anfitrião caiu');
  assert.equal(t.endedText(null, true), null);
  for (const s of [t.resumeText(until, now), t.endedText('lost', true).sub, t.endedText('lost', false).sub]) {
    assert.doesNotMatch(s, /[—–]|em breve/);
  }
});

test('as ligações: as ações do anfitrião uma de cada vez e só com a ligação de pé; o 409 «já acabou» mostra o fim', () => {
  const room = read('lib/txilladaRoom.ts');
  assert.match(room, /if \(hostRef\.current && connRef\.current !== 'connected'\) return WEAK_LINK_TEXT\(\);/);
  assert.match(room, /if \(inflight\.current\.has\(key\)\) return BUSY_TEXT\(\);/);
  assert.match(room, /return guarded\(`\$\{what\}:\$\{username\.toLowerCase\(\)\}`/);
  assert.match(room, /return guarded\(`invite:\$\{username\.toLowerCase\(\)\}`/);
  assert.match(room, /return guarded\('pin'/);
  assert.match(room, /return guarded\(`ban:\$\{username\.toLowerCase\(\)\}`/);
  assert.match(room, /if \(e instanceof ApiError && isEndedError\(e\)\) markEnded\(\);/);
  // Terminar não espera pela ligação (e um «já acabou» é o fim que se queria).
  assert.match(room, /if \(e instanceof ApiError && isEndedError\(e\)\) \{ markEnded\(\); return null; \}/);
  // Voltar a entrar sozinho: o aviso em tempo real e a pergunta de 10 em 10 s.
  assert.match(room, /if \(ev\.type === 'txillada\.resumed'\) void resumeRef\.current\(\);/);
  assert.match(room, /setInterval\(\(\) => void resumeRef\.current\(\), RESUME_POLL_MS\)/);
  assert.match(room, /dispatch\(\{ t: 'reopen', dto: d \}\);/);
  assert.match(room, /busy, canAct: !host \|\| conn === 'connected', resumeWait,/);
});

test('as ligações: a folha dos Convidados (botões ocupados, desligados com a ligação fraca, o erro lá dentro) e o resumo', () => {
  const panel = read('components/txillada/TxilladaGuests.tsx');
  assert.match(panel, /<Small label=\{t\('Tirar'\)\} kind="danger" disabled=\{offline\} busy=\{on\('remove', g\.user\.username\)\}/);
  assert.match(panel, /busy=\{on\('accept', g\.user\.username\)\}/);
  assert.match(panel, /disabled=\{disabled \|\| busy\}/);
  const screen = read('app/txillada/[id].tsx');
  assert.match(screen, /busy=\{tx\.busy\}\s+offline=\{!tx\.canAct\}\s+msg=\{guestMsg\}/);
  // O aviso por cima de uma folha aberta (a de baixo fica tapada).
  assert.match(screen, /\{flash && panel !== null \? <View style=\{\[st\.flash, st\.flashOver/);
  assert.match(screen, /const why = lost \? endedText\('lost', tx\.resumeWait\) : null;/);
  assert.match(screen, /lost=\{lost \? \{ until: resumeUntil, busy: reopening, onPress: canResume \? \(\) => void reopen\(true\) : null \} : null\}/);
  // Expulsar passa pela mesma guarda.
  assert.match(screen, /const e = await tx\.banUser\(username\);/);
  assert.match(read('components/txillada/TxilladaParts.tsx'), /label=\{t\('Continuar a Txillada'\)\}/);
});
