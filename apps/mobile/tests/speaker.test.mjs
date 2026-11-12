// Testes do viva-voz (altifalante) das chamadas: src/lib/calls/speaker.ts (a regra), a ligação em session.ts,
// webrtc.ts e webrtc.web.ts, o botão no CallOverlay e os módulos nativos (modules/call-service: Kotlin e Swift).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'calls', 'speaker.ts')).href);

test('estado inicial: voz no auscultador, vídeo no altifalante', () => {
  assert.equal(m.initialSpeaker(false), false);
  assert.equal(m.initialSpeaker(true), true);
  const s = read('src', 'lib', 'calls', 'session.ts');
  // Ligar, receber e atender usam todos a mesma regra.
  assert.match(s, /phase: 'outgoing', outgoing: true, peer: hint, video, camOn: video, speaker: initialSpeaker\(video\)/);
  assert.match(s, /phase: 'incoming', outgoing: false, callId, peer: from, video, camOn: video, speaker: initialSpeaker\(video\)/);
  assert.match(s, /phase: 'connecting', local: null, camOn: withVideo, speaker: initialSpeaker\(withVideo \|\| state\.video\)/);
  assert.match(s, /speaker: false, audioRoute: null,/, 'em repouso: altifalante desligado, rota por saber');
});

test('onde aparece o botão: app sempre; computador com 2+ saídas; iPhone pelo browser nunca', () => {
  assert.equal(m.speakerUi({ os: 'android' }), 'toggle');
  assert.equal(m.speakerUi({ os: 'ios' }), 'toggle');
  assert.equal(m.speakerUi({ os: 'web', sinkSupported: true, outputs: 2 }), 'picker');
  assert.equal(m.speakerUi({ os: 'web', sinkSupported: true, outputs: 1 }), 'none', 'uma só saída: nada para escolher');
  assert.equal(m.speakerUi({ os: 'web', sinkSupported: false, outputs: 3 }), 'none', 'sem setSinkId (Firefox antigo)');
  assert.equal(m.speakerUi({ os: 'web', appleMobileWeb: true, sinkSupported: true, outputs: 3 }), 'none', 'iPhone/iPad: sem botão morto');
  assert.equal(m.speakerUi({ os: 'windows' }), 'none');
});

test('deteção do iPhone/iPad no browser (o iPadOS diz-se Mac, mas tem ecrã tátil)', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
  const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  assert.equal(m.isAppleMobile(iphone), true);
  assert.equal(m.isAppleMobile(ipad, 'MacIntel', 5), true);
  assert.equal(m.isAppleMobile(ipad, 'MacIntel', 0), false, 'Mac a sério');
  assert.equal(m.isAppleMobile(chromeAndroid, 'Linux armv8l', 5), false);
});

test('o botão acende com o altifalante e apaga com auscultadores; o rótulo diz o estado', () => {
  assert.equal(m.speakerLit(true, null), true, 'antes de o telemóvel dizer nada: o que se pediu');
  assert.equal(m.speakerLit(false, 'unknown'), false);
  assert.equal(m.speakerLit(false, 'speaker'), true, 'a rota manda');
  assert.equal(m.speakerLit(true, 'bluetooth'), false);
  assert.equal(m.speakerLit(true, 'wired'), false);
  assert.equal(m.speakerLit(true, 'earpiece'), false);
  assert.equal(m.speakerLabel(true), 'Altifalante ligado');
  assert.equal(m.speakerLabel(false), 'Altifalante desligado');
});

test('auscultadores: ao ligar, o som vai para eles; ao tirar, volta ao auscultador (ou ao altifalante no vídeo)', () => {
  const R = (route, headset = null) => ({ route, headset });
  // Primeiro aviso da chamada, já com Bluetooth ligado (mesmo numa videochamada): vai para o Bluetooth.
  assert.equal(m.speakerAfterRoute(undefined, R('speaker', 'bluetooth'), true), false);
  // Sem auscultadores no primeiro aviso: fica como está.
  assert.equal(m.speakerAfterRoute(undefined, R('earpiece'), false), null);
  // Liga os com fio a meio.
  assert.equal(m.speakerAfterRoute(null, R('speaker', 'wired'), false), false);
  // Mesmos auscultadores (ex.: tocou no botão para pôr no altifalante): não se mexe.
  assert.equal(m.speakerAfterRoute('bluetooth', R('speaker', 'bluetooth'), false), null);
  // Tira-os: voz → auscultador; vídeo com câmara → altifalante.
  assert.equal(m.speakerAfterRoute('bluetooth', R('earpiece'), false), false);
  assert.equal(m.speakerAfterRoute('wired', R('earpiece'), true), true);
  // Troca do fio para o Bluetooth: vai para o novo.
  assert.equal(m.speakerAfterRoute('wired', R('bluetooth', 'bluetooth'), false), false);
});

test('o que vem do módulo nativo normaliza-se', () => {
  assert.deepEqual(m.parseReport({ route: 'speaker', headset: 'none' }), { route: 'speaker', headset: null });
  assert.deepEqual(m.parseReport({ route: 'bluetooth', headset: 'bluetooth' }), { route: 'bluetooth', headset: 'bluetooth' });
  assert.deepEqual(m.parseReport({ route: 'carplay', headset: 'x' }), { route: 'unknown', headset: null });
  assert.deepEqual(m.parseReport(null), { route: 'unknown', headset: null });
});

/** O expo-audio e o módulo nativo de mentira, a registar a ordem. */
function fakes(withNative = true) {
  const log = [];
  const mode = async (on, speaker) => { log.push(['mode', on, speaker]); await Promise.resolve(); };
  const native = withNative ? { setSpeaker: (on) => { log.push(['setSpeaker', on]); return on ? 'speaker' : 'earpiece'; }, resetAudio: () => log.push(['resetAudio']) } : null;
  return { log, mode, native };
}

test('com o módulo nativo: modo de comunicação primeiro, depois a saída; no fim repõe uma só vez', async () => {
  const f = fakes();
  const a = m.createCallAudio(f.mode, f.native);
  await a.start(false); // chamada de voz
  await a.start(true); // tocou no botão
  await a.start(false);
  await a.end();
  await a.end(); // o teardown pode correr duas vezes
  assert.deepEqual(f.log, [['mode', true, false], ['setSpeaker', false], ['setSpeaker', true], ['setSpeaker', false], ['mode', false, false], ['resetAudio']]);
  assert.equal(a.isActive(), false);
});

test('videochamada: começa no altifalante; tocar no botão a meio do arranque vale o último pedido', async () => {
  const f = fakes();
  const a = m.createCallAudio(f.mode, f.native);
  const p = a.start(true);
  const q = a.start(false); // ainda a preparar o modo de áudio
  await Promise.all([p, q]);
  assert.deepEqual(f.log[0], ['mode', true, false], 'o expo-audio fica no modo de comunicação; quem escolhe é o módulo');
  assert.deepEqual(f.log.at(-1), ['setSpeaker', false]);
  assert.equal(a.wanted(), false);
});

test('a chamada acaba enquanto o áudio arranca: não fica o altifalante ligado depois do fim', async () => {
  const f = fakes();
  const a = m.createCallAudio(f.mode, f.native);
  const p = a.start(true);
  const e = a.end();
  await Promise.all([p, e]);
  assert.deepEqual(f.log.filter((x) => x[0] === 'setSpeaker'), [], 'nada de setSpeaker depois do fim');
  assert.deepEqual(f.log.at(-1), ['resetAudio']);
});

test('sem o módulo (APK antigo): fica o expo-audio, como antes', async () => {
  const f = fakes(false);
  const a = m.createCallAudio(f.mode, null);
  await a.start(false);
  await a.start(true);
  await a.end();
  assert.deepEqual(f.log, [['mode', true, false], ['mode', true, true], ['mode', false, false]]);
});

test('se o módulo nativo rebentar, a chamada não rebenta', async () => {
  const a = m.createCallAudio(async () => undefined, { setSpeaker: () => { throw new Error('x'); }, resetAudio: () => { throw new Error('x'); } });
  await assert.doesNotReject(async () => { await a.start(true); await a.start(false); await a.end(); });
});

test('ligações: fim da chamada repõe o áudio; avisos de rota; botão ao lado do microfone', () => {
  const s = read('src', 'lib', 'calls', 'session.ts');
  assert.match(s, /function teardown\(\) \{[\s\S]*?void rtc\.callAudio\(false, false\);\n  headset = undefined;/);
  assert.match(s, /rtc\.onAudioRoute\(\(r\) => \{[\s\S]*?speakerAfterRoute\(headset, r, state\.camOn\)/);
  assert.match(s, /export function toggleSpeaker\(\) \{\n  if \(state\.phase === 'idle' \|\| state\.phase === 'ended' \|\| state\.phase === 'incoming'\) return;\n  setSpeaker\(!speakerLit\(state\.speaker, state\.audioRoute\)\);/);
  const nat = read('src', 'lib', 'calls', 'webrtc.ts');
  assert.match(nat, /Platform\.OS === 'android' \|\| Platform\.OS === 'ios' \? requireOptionalNativeModule<TxAudioModule>\('TxCallService'\) : null/);
  assert.match(nat, /const audio = createCallAudio\(audioMode, speakerNative\);/);
  const web = read('src', 'lib', 'calls', 'webrtc.web.ts');
  assert.match(web, /if \(!sinkSupported\(\) \|\| appleMobileWeb\(\)\) return \[\];/);
  assert.match(web, /'setSinkId' in HTMLMediaElement\.prototype/);
  assert.match(web, /d\.kind === 'audiooutput'/);
  const ov = read('src', 'components', 'calls', 'CallOverlay.tsx');
  assert.doesNotMatch(ov, /speakerSelectable/);
  // Em chamada: microfone, (câmara), altifalante, desligar.
  assert.match(ov, /<Ctrl label=\{c\.micOn \? 'Desligar o microfone'[\s\S]*?<SpeakerButton c=\{c\} \/>\n        <Pressable onPress=\{hangUp\}/);
  // A chamar: microfone | cancelar | altifalante (ou o lugar vazio).
  assert.match(ov, /<BigBtn bg=\{RED\} label="Cancelar" onPress=\{hangUp\}>[\s\S]*?<SpeakerButton c=\{c\} spacer \/>/);
  assert.match(ov, /<Ctrl label=\{speakerLabel\(lit\)\}[^>]*off=\{lit\} onPress=\{toggleSpeaker\}>/);
  assert.match(ov, /if \(mode === 'none'\) return spacer \? <View style=\{\{ width: 56 \}\} \/> : null;/);
});

test('Android (Kotlin): setCommunicationDevice no 12+, isSpeakerphoneOn abaixo, e repõe MODE_NORMAL no fim', () => {
  const dir = ['modules', 'call-service', 'android', 'src', 'main', 'java', 'com', 'txillapp', 'callservice'];
  const a = read(...dir, 'CallAudio.kt');
  assert.match(a, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S/);
  assert.match(a, /am\.setCommunicationDevice\(target\)/);
  assert.match(a, /am\.clearCommunicationDevice\(\)/);
  assert.match(a, /TYPE_BUILTIN_SPEAKER/);
  assert.match(a, /TYPE_BUILTIN_EARPIECE/);
  assert.match(a, /am\.mode = AudioManager\.MODE_IN_COMMUNICATION/);
  assert.match(a, /am\.isSpeakerphoneOn = on/);
  assert.match(a, /am\.startBluetoothSco\(\)/);
  assert.match(a, /fun reset\(\) \{[\s\S]*?am\.mode = AudioManager\.MODE_NORMAL/);
  assert.match(a, /registerAudioDeviceCallback/);
  const mod = read(...dir, 'CallServiceModule.kt');
  assert.match(mod, /Events\("onHangUp", "onAudioRoute"\)/);
  assert.match(mod, /Function\("setSpeaker"\) \{ on: Boolean -> audio\(\)\.setSpeaker\(on\) \}/);
  assert.match(mod, /Function\("audioRoute"\)/);
  assert.match(mod, /Function\("resetAudio"\) \{ audio\?\.reset\(\) \}/);
  const manifest = read('modules', 'call-service', 'android', 'src', 'main', 'AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  const app = JSON.parse(read('app.json')).expo.android;
  assert.ok(app.permissions.includes('MODIFY_AUDIO_SETTINGS'));
  assert.ok(!app.blockedPermissions.includes('android.permission.MODIFY_AUDIO_SETTINGS'));
});

test('iPhone (Swift): playAndRecord / voiceChat e overrideOutputAudioPort(.speaker / .none)', () => {
  const cfg = JSON.parse(read('modules', 'call-service', 'expo-module.config.json'));
  assert.deepEqual(cfg.platforms, ['android', 'apple']);
  assert.deepEqual(cfg.apple.modules, ['CallServiceModule']);
  assert.ok(existsSync(path.join(ROOT, 'modules', 'call-service', 'ios', 'TxCallService.podspec')));
  const sw = read('modules', 'call-service', 'ios', 'CallServiceModule.swift');
  assert.match(sw, /Name\("TxCallService"\)/);
  assert.match(sw, /setCategory\(\.playAndRecord, mode: \.voiceChat, options: options\)/);
  assert.match(sw, /overrideOutputAudioPort\(wantSpeaker \? \.speaker : \.none\)/);
  assert.match(sw, /Function\("resetAudio"\) \{[\s\S]*?overrideOutputAudioPort\(\.none\)/);
  assert.match(sw, /AVAudioSession\.routeChangeNotification/);
  // O serviço em primeiro plano continua só no Android.
  assert.match(read('src', 'lib', 'calls', 'callServiceNative.ts'), /Platform\.OS === 'android' \? requireOptionalNativeModule/);
});
