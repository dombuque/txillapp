// «A chamar…» / «A tocar…» de quem liga (src/lib/calls/outgoing.ts) e onde a app confirma a entrega: o ecrã e a sessão.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'calls', 'outgoing.ts')).href);

const peer = { username: 'malta', displayName: 'Malta Fixe', hasAvatar: false };
const S = (extra = {}) => ({ phase: 'outgoing', outgoing: true, callId: 'c1', delivered: false, unreachable: false, peer, ...extra });

test('o texto de quem liga: «A ligar…» sem resposta do servidor, «A chamar…» até chegar, «A tocar…» quando chega', () => {
  assert.equal(m.outgoingLabel({ callId: null, delivered: false }), 'A ligar…');
  assert.equal(m.outgoingLabel({ callId: 'c1', delivered: false }), 'A chamar…');
  assert.equal(m.outgoingLabel({ callId: 'c1', delivered: true }), 'A tocar…');
});

test('as fases: o «ringing» desta chamada passa a «A tocar…»; de outra chamada, repetido ou já atendida, nada muda', () => {
  assert.deepEqual(m.afterDelivered(S(), 'c1'), { delivered: true, unreachable: false });
  assert.deepEqual(m.afterDelivered(S({ unreachable: true }), 'c1'), { delivered: true, unreachable: false }); // chegou tarde: a linha sai
  assert.equal(m.afterDelivered(S(), 'c2'), null);
  assert.equal(m.afterDelivered(S({ delivered: true }), 'c1'), null);
  assert.equal(m.afterDelivered(S({ phase: 'connecting' }), 'c1'), null);
  assert.equal(m.afterDelivered(S({ phase: 'incoming', outgoing: false }), 'c1'), null);
  assert.equal(m.afterDelivered(S({ callId: null }), 'c1'), null);
});

test('sem entrega ao fim de 15 s: só a linha discreta, sem desligar; e não aparece se já chegou', () => {
  assert.equal(m.UNREACHABLE_MS, 15_000);
  assert.deepEqual(m.afterUnreachable(S()), { unreachable: true });
  assert.equal(m.afterUnreachable(S({ delivered: true })), null);
  assert.equal(m.afterUnreachable(S({ unreachable: true })), null);
  assert.equal(m.afterUnreachable(S({ phase: 'ended' })), null);
  assert.equal(m.afterUnreachable(S({ callId: null })), null);
  // A mudança nunca mexe na fase (a chamada continua a chamar até ao tempo de sempre).
  assert.equal('phase' in m.afterUnreachable(S()), false);

  assert.equal(m.unreachableText(S({ unreachable: true })), 'Sem resposta do telemóvel de Malta Fixe');
  assert.equal(m.unreachableText(S({ unreachable: true, peer: { username: 'malta', displayName: ' ', hasAvatar: false } })), 'Sem resposta do telemóvel de @malta');
  assert.equal(m.unreachableText(S({ unreachable: true, peer: null })), 'Sem resposta do telemóvel');
  assert.equal(m.unreachableText(S()), null);
  assert.equal(m.unreachableText(S({ unreachable: true, delivered: true })), null);
  assert.equal(m.unreachableText(S({ unreachable: true, phase: 'connecting' })), null);
});

test('a sessão confirma a entrega ao mostrar uma chamada a entrar e ouve o «ringing»; o tempo de toque de quem liga fica igual', () => {
  const s = read('src', 'lib', 'calls', 'session.ts');
  const open = s.slice(s.indexOf('export function openIncomingCall'), s.indexOf('export async function acceptCall'));
  assert.match(open, /callsApi\.ringing\(callId\)/);
  // Só depois de passar a tocar aqui (ocupado noutra chamada recusa, não confirma).
  assert.ok(open.indexOf('callsApi.ringing') > open.indexOf("phase: 'incoming'"));
  assert.ok(open.indexOf('callsApi.decline') < open.indexOf('callsApi.ringing'));
  assert.match(s, /case 'ringing':/);
  assert.match(s, /const RING_OUT_MS = 45_000/);
  assert.match(read('src', 'lib', 'calls', 'api.ts'), /ringing: \(id: string\)[^\n]*\/ringing`, post\(\{\}\)\)/);
  const overlay = read('src', 'components', 'calls', 'CallOverlay.tsx');
  assert.match(overlay, /outgoingLabel\(c\)/);
  assert.match(overlay, /unreachableText\(c\)/);
});

test('Android com a app fechada: o serviço FCM do módulo das chamadas confirma a entrega depois de mostrar a notificação', () => {
  const dir = ['modules', 'call-service', 'android'];
  const manifest = read(...dir, 'src', 'main', 'AndroidManifest.xml');
  assert.match(manifest, /android:name="com\.txillapp\.callservice\.TxMessagingService"/);
  // Ganha ao do expo-notifications (prioridade -1) e não é um foreground service (não precisa de declaração na Play).
  const prio = Number(/<intent-filter android:priority="(-?\d+)">\s*<action android:name="com\.google\.firebase\.MESSAGING_EVENT"/.exec(manifest)?.[1]);
  assert.ok(prio > -1);
  assert.doesNotMatch(manifest, /foregroundServiceType/);
  const kt = read(...dir, 'src', 'main', 'java', 'com', 'txillapp', 'callservice', 'TxMessagingService.kt');
  assert.match(kt, /class TxMessagingService : ExpoFirebaseMessagingService\(\)/);
  const body = kt.slice(kt.indexOf('override fun onMessageReceived'));
  assert.ok(body.indexOf('super.onMessageReceived(remoteMessage)') < body.indexOf('openConnection'), 'a notificação primeiro');
  assert.match(body, /data\["kind"\] != "call"/);
  // O endereço que o servidor manda (calls.service.ts) passa no filtro do Kotlin.
  const re = new RegExp(/Regex\("(.+)"\)/.exec(kt)[1].replace(/\\\\/g, '\\'));
  assert.ok(re.test('https://txillapp.com/api/v1/calls/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/ringing?ack=1800000000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'));
  assert.ok(!re.test('https://txillapp.com/api/v1/users/me?ack=1'));
  assert.ok(!re.test('file:///data/x'));
  const gradle = read(...dir, 'build.gradle');
  // Só para compilar: na app o expo-notifications (já compilado no Expo 58) traz as classes.
  assert.match(gradle, /compileOnly 'host\.exp\.exponent:expo\.modules\.notifications:\+'/);
  assert.match(gradle, /compileOnly 'com\.google\.firebase:firebase-messaging:/);
});
