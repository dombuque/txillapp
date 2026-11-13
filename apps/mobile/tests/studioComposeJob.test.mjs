// Estúdio nativo: «Seguinte» (enviar, pedir a montagem, esperar), retomar a montagem ao voltar e as mensagens de erro.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'composeJob.ts')).href);

const clips = [
  { media: 'a', uri: 'file:///a.mp4', mime: 'video/mp4', video: true },
  { media: 'b', uri: 'file:///b.jpg', mime: 'image/jpeg', video: false },
  { media: 'a', uri: 'file:///a.mp4', mime: 'video/mp4', video: true },
];

test('um ficheiro por media, mais a voz-off; o que já foi enviado (do mesmo caminho) não volta a ir', () => {
  const files = j.uploadFiles(clips, { id: 'v1', uri: 'file:///voz.m4a', mime: 'audio/mp4' });
  assert.deepEqual(files.map((f) => [f.key, f.kind]), [['a', 'video'], ['b', 'photo'], ['voz:v1', 'voice']]);
  let rec = j.withSent(j.emptyRecord('st-1'), 'a', { uri: 'file:///a.mp4', mediaId: 'm-a' });
  rec = j.withSent(rec, 'b', { uri: 'file:///OUTRO.jpg', mediaId: 'm-b' });
  const plan = j.uploadPlan(files, rec);
  assert.deepEqual(plan.ready, { a: 'm-a' });
  assert.deepEqual(plan.pending.map((f) => f.key), ['b', 'voz:v1'], 'um ficheiro substituído envia-se de novo');
  assert.deepEqual(Object.keys(j.withoutSent(rec, 'a').sent), ['b']);
});

test('o registo sobrevive a ser guardado e lido; um registo estragado ou de outra versão não serve', () => {
  let rec = j.withSent(j.emptyRecord('st-1'), 'a', { uri: 'u', mediaId: 'm' });
  rec = j.withJob(rec, 'job-1', 'sig', 5000);
  assert.deepEqual(j.parseRecord(JSON.stringify(rec)), rec);
  assert.equal(j.parseRecord('{x'), null);
  assert.equal(j.parseRecord(JSON.stringify({ ...rec, v: 99 })), null);
  assert.deepEqual(j.withoutJob(rec), { v: 1, draftId: 'st-1', sent: rec.sent });
});

test('retomar: só com uma montagem recente; diz se ainda é deste projeto', () => {
  const rec = j.withJob(j.emptyRecord('st-1'), 'job-1', 'sig-A', 1000);
  assert.deepEqual(j.resumeOf(rec, 'sig-A', 60_000), { action: 'poll', jobId: 'job-1', same: true });
  assert.deepEqual(j.resumeOf(rec, 'sig-B', 60_000), { action: 'poll', jobId: 'job-1', same: false });
  assert.deepEqual(j.resumeOf(rec, 'sig-A', 1000 + j.JOB_MAX_AGE_MS + 1), { action: 'none' });
  assert.deepEqual(j.resumeOf(j.emptyRecord('x'), 'sig', 0), { action: 'none' });
  assert.deepEqual(j.resumeOf(null, 'sig', 0), { action: 'none' });
});

test('o progresso: os envios até 40 %, depois o do servidor, com as fases do docs/montagem.md', () => {
  const u = j.uploadState(1, 4, 0.5, 'video');
  assert.equal(u.phase, 'enviar');
  assert.equal(Math.round(u.progress * 1000) / 1000, 0.15);
  assert.match(u.detail, /vídeo 2 de 4 · 50%/);
  assert.match(j.uploadState(0, 1, 0, 'photo', 2).detail, /A rede caiu. A tentar outra vez \(2 de 4\)/);
  assert.equal(j.serverState('queued', 0).phase, 'fila');
  assert.equal(j.serverState('working', 0.05).phase, 'preparar');
  assert.equal(j.serverState('working', 0.3).phase, 'clipes');
  assert.equal(j.serverState('working', 0.6).phase, 'final');
  assert.equal(j.serverState('working', 0.97).phase, 'acabar');
  assert.equal(j.serverState('working', 1).progress, 1);
  assert.equal(j.serverState('working', 0).progress, j.UPLOAD_SHARE);
  assert.match(j.serverState('working', 0.5, 120_000).detail, /Podes sair da app/);
});

test('os erros do servidor viram frases claras', () => {
  assert.deepEqual(j.composeProblem(400, 'Junta mais 2 fotos'), { kind: 'corrigir', message: 'Junta mais 2 fotos', unknownField: false });
  assert.equal(j.composeProblem(400, 'Pedido inválido (clips.0.sound)').unknownField, true);
  assert.equal(j.composeProblem(409, 'Já tens uma tcheka a montar. Espera que acabe.').kind, 'ocupado');
  assert.match(j.composeProblem(429, 'Too Many Requests').message, /muitas montagens/);
  assert.equal(j.composeProblem(0).kind, 'rede');
  assert.equal(j.composeProblem(401).kind, 'sessao');
  assert.match(j.composeProblem(502, 'Bad Gateway').message, /servidor não conseguiu/);
  assert.equal(j.isNetworkError(0), true);
  assert.equal(j.isNetworkError(500), false);
});

test('esperas: os envios caídos e as perguntas ao servidor abrandam; o resultado de cada pergunta', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(j.retryDelay), [1500, 3000, 6000, 10000, 10000]);
  assert.deepEqual([0, 1, 2, 5].map(j.pollDelay), [1000, 2000, 4000, 8000]);
  assert.deepEqual(j.pollOutcome(200, { status: 'working', progress: 0.3 }), { kind: 'wait' });
  assert.deepEqual(j.pollOutcome(200, { status: 'done', mediaId: 'm', durationMs: 12000 }), { kind: 'done', mediaId: 'm', durationMs: 12000 });
  assert.deepEqual(j.pollOutcome(200, { status: 'failed', error: 'Tira 10 s (máximo 60 s)' }), { kind: 'failed', message: 'Tira 10 s (máximo 60 s)' });
  assert.deepEqual(j.pollOutcome(404, null), { kind: 'gone' });
  assert.deepEqual(j.pollOutcome(503, null), { kind: 'wait' });
});
