// A Txillada no Android, para quem vê (plugins/withLiveKitDecoders.js, lib/txilladaLive*.ts, lib/txilladaRoom.ts):
// - os vídeos VP8/VP9/AV1 que chegam pelo WebRTC descodificam-se em software (com o descodificador VP8 do aparelho a
//   imagem ficava preta), o H.264 continua no do aparelho;
// - no telemóvel não aparece o «Toca para ouvir» (o som toca sozinho; o livekit-client diz que não pode tocar no RN).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const plugin = require(path.join(ROOT, 'plugins', 'withLiveKitDecoders.js'));
const appJson = JSON.parse(read('app.json')).expo;

const MAIN = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

/** Corre o plugin sobre um MainApplication (sem o prebuild): o withMainApplication do Expo chama o mod com o ficheiro. */
function apply(contents, language = 'kt') {
  const cfg = { modResults: { language, contents } };
  const fakeConfig = { mods: { android: {} } };
  // O plugin chama withMainApplication(config, fn): o mod regista-se em config.mods.android.mainApplication.
  const out = plugin(fakeConfig);
  const mod = out.mods.android.mainApplication;
  return mod({ ...cfg, modRequest: { platform: 'android' }, modRawConfig: {} });
}

test('o plugin está no app.json', () => {
  const names = appJson.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(names.includes('./plugins/withLiveKitDecoders'), 'falta o ./plugins/withLiveKitDecoders no app.json');
});

test('o VP8, o VP9 e o AV1 passam a software logo depois do setup da LiveKit (o H.264 fica no aparelho)', async () => {
  const r = await apply(MAIN);
  const src = r.modResults.contents;
  const setup = src.indexOf('ApplicationLifecycleDispatcher.onApplicationCreate(this)');
  const sw = src.indexOf('setForceSWCodecList(listOf("VP8", "VP9", "AV1"))');
  assert.ok(sw > setup && setup > 0, 'a troca tem de vir depois do LiveKitReactNative.setup (onApplicationCreate)');
  assert.ok(sw < src.indexOf('override fun onConfigurationChanged'), 'dentro do onCreate');
  assert.match(src, /videoDecoderFactory as\? com\.livekit\.reactnative\.video\.CustomVideoDecoderFactory/);
  assert.doesNotMatch(src.slice(sw - 200, sw + 60), /H264/, 'o H.264 não vai para software');
});

test('correr o plugin duas vezes não duplica a troca', async () => {
  const once = (await apply(MAIN)).modResults.contents;
  const twice = (await apply(once)).modResults.contents;
  assert.equal(twice, once);
});

test('sem o onApplicationCreate (o modelo do Expo mudou) o prebuild falha em vez de ficar sem a troca', async () => {
  await assert.rejects(async () => apply(MAIN.replace('ApplicationLifecycleDispatcher.onApplicationCreate(this)', '')), /onApplicationCreate/);
  await assert.rejects(async () => apply(MAIN, 'java'), /Kotlin/);
});

test('o «Toca para ouvir» só existe no browser', () => {
  assert.match(read('src', 'lib', 'txilladaLive.ts'), /export const audioNeedsTap = false;/);
  assert.match(read('src', 'lib', 'txilladaLive.web.ts'), /export const audioNeedsTap = true;/);
  const room = read('src', 'lib', 'txilladaRoom.ts');
  const blocked = room.match(/setAudioBlocked\([^;]*\);/g) ?? [];
  assert.ok(blocked.length >= 3);
  for (const b of blocked) assert.match(b, /audioNeedsTap &&/, `sem o audioNeedsTap: ${b}`);
});

test('quem vê no telemóvel não usa o adaptive stream (o VideoView mandava parar o vídeo); no browser usa', () => {
  assert.match(read('src', 'lib', 'txilladaLive.ts'), /export const adaptiveVideo = false;/);
  assert.match(read('src', 'lib', 'txilladaLive.web.ts'), /export const adaptiveVideo = true;/);
  assert.match(read('src', 'lib', 'txilladaRoom.ts'), /adaptiveStream: !amHost && adaptiveVideo \? \{ pixelDensity: 'screen' as const \} : false,/);
});
