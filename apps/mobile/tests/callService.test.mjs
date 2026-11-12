// Testes do serviço em primeiro plano das chamadas no Android (src/lib/calls/callService.ts, callServiceNative.ts,
// modules/call-service e plugins/withCallService.js): quando arranca, quando troca de tipo e quando pára, e que é o
// único foreground service do manifesto, com o tipo microphone|camera.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'calls', 'callService.ts')).href);
const appJson = JSON.parse(read('app.json')).expo;

const peer = { username: 'malta', displayName: 'Malta Fixe', hasAvatar: false };
const S = (phase, extra = {}) => ({ phase, peer, camOn: false, local: phase === 'idle' ? null : {}, ...extra });

/** Um módulo nativo de mentira que regista as chamadas. */
function fakeNative() {
  const calls = [];
  return { calls, start: (name, video) => { calls.push(['start', name, video]); return true; }, stop: () => calls.push(['stop']) };
}

test('o serviço corre só com a chamada a chamar, a ligar ou ligada, e com o microfone já aberto', () => {
  assert.equal(m.callServiceWant(S('idle')), null);
  assert.equal(m.callServiceWant(S('incoming')), null, 'a tocar ainda não');
  assert.equal(m.callServiceWant(S('ended')), null);
  assert.equal(m.callServiceWant(S('outgoing', { local: null })), null, 'antes de haver microfone (licença por dar) não');
  assert.deepEqual(m.callServiceWant(S('outgoing')), { name: 'Malta Fixe', video: false });
  assert.deepEqual(m.callServiceWant(S('connecting')), { name: 'Malta Fixe', video: false });
  assert.deepEqual(m.callServiceWant(S('active', { camOn: true })), { name: 'Malta Fixe', video: true });
  // Sem nome: o @ ou o nome da app.
  assert.equal(m.callServiceWant(S('active', { peer: { username: 'ze', displayName: ' ', hasAvatar: false } })).name, '@ze');
  assert.equal(m.callServiceWant(S('active', { peer: null })).name, 'Txillapp');
});

test('ciclo de uma chamada de voz que liguei: arranca uma vez, pára no fim', () => {
  const n = fakeNative();
  const svc = m.createCallServiceSync(n);
  svc.sync(S('idle'));
  svc.sync(S('outgoing', { local: null })); // a pedir o microfone
  svc.sync(S('outgoing')); // microfone aberto
  svc.sync(S('connecting'));
  svc.sync(S('active'));
  svc.sync(S('active')); // outra mudança qualquer (ex.: silenciar): nada de novo
  svc.sync(S('ended', { local: null }));
  svc.sync(S('idle'));
  assert.deepEqual(n.calls, [['start', 'Malta Fixe', false], ['stop']]);
  assert.equal(svc.current(), null);
});

test('chamada atendida que passa a vídeo e volta a voz: o tipo do serviço acompanha a câmara', () => {
  const n = fakeNative();
  const svc = m.createCallServiceSync(n);
  svc.sync(S('incoming', { local: null }));
  svc.sync(S('connecting', { local: null })); // atendi: a abrir o microfone
  svc.sync(S('connecting'));
  svc.sync(S('active', { camOn: true })); // liguei a câmara
  svc.sync(S('active', { camOn: false })); // desliguei
  svc.sync(S('ended', { local: null, endReason: 'remote' })); // a outra pessoa desligou
  assert.deepEqual(n.calls, [['start', 'Malta Fixe', false], ['start', 'Malta Fixe', true], ['start', 'Malta Fixe', false], ['stop']]);
});

test('a chamada falha, ou a pessoa sai da conta a meio: o serviço pára', () => {
  const n = fakeNative();
  const svc = m.createCallServiceSync(n);
  svc.sync(S('active'));
  svc.dispose(); // logout / o ecrã da chamada desmontou
  svc.dispose(); // duas vezes não pára duas vezes
  assert.deepEqual(n.calls, [['start', 'Malta Fixe', false], ['stop']]);
  const f = fakeNative();
  const s2 = m.createCallServiceSync(f);
  s2.sync(S('outgoing'));
  s2.sync(S('ended', { local: null, endReason: 'failed' }));
  assert.deepEqual(f.calls, [['start', 'Malta Fixe', false], ['stop']]);
});

test('se o módulo nativo rebentar, a chamada não rebenta', () => {
  const svc = m.createCallServiceSync({ start: () => { throw new Error('sem módulo'); }, stop: () => { throw new Error('sem módulo'); } });
  assert.doesNotThrow(() => { svc.sync(S('active')); svc.sync(S('idle')); svc.dispose(); });
});

test('ligações no JS: o CallOverlay instala o serviço; sair ou trocar de conta desliga a chamada', () => {
  const overlay = read('src', 'components', 'calls', 'CallOverlay.tsx');
  assert.match(overlay, /useEffect\(\(\) => installCallService\(\), \[\]\);\r?\n  const c = useCall\(\);/);
  const nat = read('src', 'lib', 'calls', 'callServiceNative.ts');
  assert.match(nat, /Platform\.OS === 'android' \? requireOptionalNativeModule<TxCallServiceModule>\('TxCallService'\) : null/);
  assert.match(nat, /if \(!native\) return \(\) => undefined;/); // iPhone, web e APK sem o módulo: nada
  assert.match(nat, /native\.addListener\('onHangUp', \(\) => hangUp\(\)\)/);
  const auth = read('src', 'lib', 'auth.tsx');
  assert.match(auth, /const signOut = useCallback\(async \(\): Promise<boolean> => \{\r?\n    hangUp\(\);/);
  assert.match(auth, /const switchTo = useCallback\(async \(username: string\) => \{\r?\n    hangUp\(\);/);
});

test('o módulo nativo: serviço só no Android, tipo microphone (+ camera), notificação baixa «Chamadas em curso» com Desligar', () => {
  const cfg = JSON.parse(read('modules', 'call-service', 'expo-module.config.json'));
  assert.deepEqual(cfg.platforms, ['android', 'apple']); // o iPhone só tem o viva-voz (tests/speaker.test.mjs)
  assert.deepEqual(cfg.android.modules, ['com.txillapp.callservice.CallServiceModule']);
  const dir = ['modules', 'call-service', 'android', 'src', 'main', 'java', 'com', 'txillapp', 'callservice'];
  const svc = read(...dir, 'CallService.kt');
  assert.match(svc, /FOREGROUND_SERVICE_TYPE_MICROPHONE/);
  assert.match(svc, /if \(video\) listOf\(mic or cam, mic\) else listOf\(mic\)/);
  assert.doesNotMatch(svc, /PHONE_CALL/);
  assert.match(svc, /NotificationChannel\(CHANNEL_ID, "Chamadas em curso", NotificationManager\.IMPORTANCE_LOW\)/);
  assert.match(svc, /setContentTitle\("Chamada com \$name"\)/);
  assert.match(svc, /addAction\(0, "Desligar", hangUp\)/);
  assert.match(svc, /setOngoing\(true\)/);
  const mod = read(...dir, 'CallServiceModule.kt');
  assert.match(mod, /Name\("TxCallService"\)/);
  assert.match(mod, /Events\("onHangUp", "onAudioRoute"\)/);
  // Sem licença do microfone não arranca (o Android 14 recusava); sem licença de notificações arranca na mesma.
  assert.match(mod, /if \(!granted\(Manifest\.permission\.RECORD_AUDIO\)\) return@Function false/);
  assert.doesNotMatch(mod, /POST_NOTIFICATIONS/);
});

test('o plugin põe o serviço e as permissões no manifesto; é o único foreground service', () => {
  const { addCallService, SERVICE_NAME, SERVICE_TYPES, PERMISSIONS } = require('../plugins/withCallService.js');
  assert.equal(SERVICE_NAME, 'com.txillapp.callservice.CallService');
  assert.equal(SERVICE_TYPES, 'microphone|camera');
  assert.deepEqual(PERMISSIONS, ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.FOREGROUND_SERVICE_CAMERA']);
  const manifest = { manifest: { $: {}, 'uses-permission': [{ $: { 'android:name': 'android.permission.CAMERA' } }], application: [{ $: { 'android:name': '.MainApplication' } }] } };
  const out = addCallService(addCallService(manifest)); // o prebuild pode correr duas vezes
  const perms = out.manifest['uses-permission'].map((p) => p.$['android:name']);
  for (const p of PERMISSIONS) assert.equal(perms.filter((x) => x === p).length, 1, p);
  const svc = out.manifest.application[0].service;
  assert.equal(svc.length, 1);
  assert.deepEqual(svc[0].$, { 'android:name': SERVICE_NAME, 'android:exported': 'false', 'android:foregroundServiceType': 'microphone|camera', 'android:stopWithTask': 'true' });
  // No app.json: o plugin está ligado, as permissões dele não estão bloqueadas, e os outros serviços continuam fora.
  assert.ok(appJson.plugins.includes('./plugins/withCallService'));
  for (const p of PERMISSIONS) assert.ok(!appJson.android.blockedPermissions.includes(p), `${p} não bloqueada`);
  for (const p of ['FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'FOREGROUND_SERVICE_MEDIA_PROJECTION', 'FOREGROUND_SERVICE_LOCATION', 'FOREGROUND_SERVICE_PHONE_CALL']) {
    assert.ok(appJson.android.blockedPermissions.includes(`android.permission.${p}`), `${p} bloqueada`);
  }
  assert.ok(appJson.plugins.includes('./plugins/withoutUnusedServices'));
  assert.ok(existsSync(path.join(ROOT, 'modules', 'call-service', 'android', 'build.gradle')));
});
