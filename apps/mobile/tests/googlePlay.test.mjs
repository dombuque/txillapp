// Testes das regras do Google Play (docs/lojas/google-play.md): sem atualização por fora da loja no canal play, as
// permissões que a política não deixa (bloqueadas no app.json), a escolha de fotos pelo seletor do sistema no Android,
// a assinatura com a chave de upload (plugins/withAndroidUploadSigning.js) e os foreground services que não se usam
// (plugins/withoutUnusedServices.js).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8');
const channel = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'channel.ts')).href);
const media = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mediaAccess.ts')).href);
const appJson = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const android = appJson.android;
const plugin = (name) => appJson.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);

// ---------- 1. Atualizações: só o APK beta tem o aviso próprio ----------

test('só o APK beta procura e sugere versões por fora da loja; play, appstore e web nunca', () => {
  assert.equal(channel.selfUpdates('beta'), true);
  assert.equal(channel.selfUpdates('play'), false);
  assert.equal(channel.selfUpdates('appstore'), false);
  assert.equal(channel.selfUpdates('web'), false);
  // Um build do Play é feito com EXPO_PUBLIC_CHANNEL=play.
  assert.equal(channel.selfUpdates(channel.channelFor('android', 'play')), false);
  // Sem indicação, o Android é o beta de sempre (tudo como estava).
  assert.equal(channel.selfUpdates(channel.channelFor('android', undefined)), true);
});

test('a versão nas Definições diz o canal (para confirmar que o .aab foi feito com EXPO_PUBLIC_CHANNEL=play)', () => {
  assert.equal(channel.channelLabel('play'), 'Google Play');
  assert.equal(channel.channelLabel('beta'), 'beta');
  assert.equal(channel.channelLabel('appstore'), 'App Store');
  assert.equal(channel.channelLabel('web'), null);
  assert.match(src('components/settings/device.tsx'), /const channel = channelLabel\(CHANNEL\);/);
});

test('o AppUpdate não pergunta nada ao servidor nem mostra o aviso fora do beta', () => {
  const s = src('components/AppUpdate.tsx');
  assert.match(s, /import \{ canSelfUpdate \} from '@\/lib\/distribution'/);
  // O efeito que vai buscar o latest.json sai logo fora do beta (antes de qualquer fetch).
  const effect = s.slice(s.indexOf('useEffect(() => {'), s.indexOf('fetch('));
  assert.match(effect, /if \(Platform\.OS !== 'android' \|\| !canSelfUpdate\) return;/);
  // E o aviso nunca se mostra (nem com estado antigo).
  assert.match(s, /if \(!latest \|\| !canSelfUpdate\) return null;/);
  const d = src('lib/distribution.ts');
  assert.match(d, /export const canSelfUpdate = selfUpdates\(CHANNEL\);/);
});

test('nenhum outro sítio da app aponta para o APK ou para o latest.json', () => {
  const files = ['app/_layout.tsx', 'components/settings/device.tsx', 'lib/legalText.ts', 'app/help.tsx', 'app/about.tsx'];
  for (const f of files) {
    const s = src(f);
    assert.doesNotMatch(s, /\.apk\b|app\/beta|latest\.json|downloads\/beta/i, `${f} não fala do APK`);
  }
});

// ---------- 2. Permissões no manifesto final ----------

const MUST_BLOCK = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.READ_CONTACTS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
];

test('o app.json bloqueia as permissões que o Play não deixa ou que a app não usa', () => {
  const blocked = new Set(android.blockedPermissions);
  for (const p of MUST_BLOCK) assert.ok(blocked.has(p), `bloqueia ${p}`);
  // E não as pede ao mesmo tempo (com ou sem o prefixo android.permission.).
  const asked = new Set(android.permissions.map((p) => (p.includes('.') ? p : `android.permission.${p}`)));
  for (const p of blocked) assert.ok(!asked.has(p), `${p} não está também em permissions`);
});

test('a localização é só em primeiro plano e as permissões pedidas são as que a app usa', () => {
  const asked = android.permissions;
  assert.ok(asked.includes('ACCESS_FINE_LOCATION') && asked.includes('ACCESS_COARSE_LOCATION'));
  assert.ok(!asked.some((p) => /BACKGROUND_LOCATION|INSTALL_PACKAGES|READ_MEDIA|FULL_SCREEN|SYSTEM_ALERT|CONTACTS|EXACT_ALARM|QUERY_ALL/.test(p)));
  // BLUETOOTH_CONNECT: só para o som das chamadas ir para auscultadores Bluetooth (justificado em docs/lojas/google-play.md).
  assert.ok(asked.includes('BLUETOOTH_CONNECT'));
});

test('a galeria: o expo-media-library não declara leituras (só guardar) e o expo-audio não traz o serviço de fundo', () => {
  const ml = plugin('expo-media-library');
  assert.ok(Array.isArray(ml), 'expo-media-library com opções');
  assert.deepEqual(ml[1].granularPermissions, []);
  assert.equal(ml[1].isAccessMediaLocationEnabled, false);
  const audio = plugin('expo-audio');
  assert.ok(Array.isArray(audio), 'expo-audio com opções');
  assert.equal(audio[1].enableBackgroundPlayback, false);
  assert.notEqual(audio[1].enableBackgroundRecording, true);
  // O iPhone continua com o áudio em segundo plano das chamadas (definido à mão no infoPlist).
  assert.ok(appJson.ios.infoPlist.UIBackgroundModes.includes('audio'));
});

test('no Android escolhe-se pelo seletor do sistema; no iPhone fica a galeria da app', () => {
  assert.equal(media.inAppGalleryFor('android'), false);
  assert.equal(media.inAppGalleryFor('ios'), true);
  const g = src('components/GalleryPicker.tsx');
  assert.match(g, /inAppGalleryFor\(Platform\.OS\) \? <InAppGallery \{\.\.\.props\} \/> : <SystemGallery \{\.\.\.props\} \/>/);
  assert.match(g, /ImagePicker\.launchImageLibraryAsync\(/);
  // O pedido da galeria (usePermissions) só existe dentro da galeria da app (iPhone).
  const sys = g.slice(g.indexOf('function SystemGallery'), g.indexOf('function InAppGallery'));
  assert.doesNotMatch(sys, /MediaLibrary\./);
  // O passo a passo das permissões não pede a galeria no Android; a câmara não lê a última foto no Android.
  assert.match(src('components/PermissionsOnboarding.tsx'), /s\.id !== 'photos' \|\| inAppGalleryFor\(Platform\.OS\)/);
  assert.match(src('components/NativeCamera.tsx'), /if \(!inAppGalleryFor\(Platform\.OS\)\) \{ setLastThumb\(null\); return; \}/);
  assert.match(src('app/(tabs)/new.tsx'), /kindSel === 'post' && !postCam && inAppGalleryFor\(Platform\.OS\)/);
});

test('guardar na galeria pede só escrita (no Android 13+ não precisa de licença nenhuma)', () => {
  for (const f of ['lib/saveToGallery.ts', 'components/PhotoEditor.tsx', 'lib/inviteCardImage.ts']) {
    const s = src(f);
    assert.match(s, /MediaLibrary\.requestPermissionsAsync\(true\)/, `${f} pede só escrita`);
    assert.doesNotMatch(s, /requestPermissionsAsync\(false/, `${f} não pede leitura`);
  }
});

test('o que vem do seletor do sistema passa a Shot; vídeos com mais de 60 s ficam de fora', () => {
  const r = media.shotsFromPicker([
    { uri: 'content://a.jpg', type: 'image', mimeType: 'image/png' },
    { uri: 'content://b.mp4', type: 'video', mimeType: 'video/mp4', duration: 12_345.6 },
    { uri: 'content://c.mp4', type: 'video', duration: 75_000 },
    { uri: 'content://d', type: null, mimeType: null },
  ]);
  assert.equal(r.tooLong, 1);
  assert.deepEqual(r.shots, [
    { uri: 'content://a.jpg', video: false, mime: 'image/png', durationMs: undefined },
    { uri: 'content://b.mp4', video: true, mime: 'video/mp4', durationMs: 12_346 },
    { uri: 'content://d', video: false, mime: 'image/jpeg', durationMs: undefined },
  ]);
});

// ---------- 3. Foreground services que não se usam ----------

test('o plugin tira do manifesto os foreground services que a app nunca arranca', () => {
  const { removeServices, UNUSED_SERVICES } = require('../plugins/withoutUnusedServices.js');
  const manifest = { manifest: { $: {}, application: [{ $: {}, service: [{ $: { 'android:name': 'outro.Servico' } }, { $: { 'android:name': UNUSED_SERVICES[0] } }] }] } };
  const out = removeServices(removeServices(manifest)); // duas vezes: o prebuild pode correr outra vez
  assert.equal(out.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  const svc = out.manifest.application[0].service;
  assert.equal(svc.length, 1 + UNUSED_SERVICES.length);
  assert.deepEqual(svc[0], { $: { 'android:name': 'outro.Servico' } });
  for (const name of UNUSED_SERVICES) assert.ok(svc.some((s) => s.$['android:name'] === name && s.$['tools:node'] === 'remove'), name);
  assert.ok(UNUSED_SERVICES.includes('com.oney.WebRTCModule.MediaProjectionService'));
  assert.ok(appJson.plugins.includes('./plugins/withoutUnusedServices'));
});

// ---------- 4. Assinatura: chave de upload por ambiente ou gradle.properties fora do git ----------

/** O pedaço do android/app/build.gradle que o expo prebuild gera (Expo 58). */
const GRADLE = `def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    ndkVersion rootProject.ext.ndkVersion
    defaultConfig {
        applicationId "com.txillapp.app"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

test('o release assina com a chave de upload quando há configuração, senão com a debug (APK beta)', () => {
  const { applySigning, KEYS } = require('../plugins/withAndroidUploadSigning.js');
  const out = applySigning(GRADLE);
  assert.deepEqual(KEYS, ['TXILLAPP_UPLOAD_STORE_FILE', 'TXILLAPP_UPLOAD_STORE_PASSWORD', 'TXILLAPP_UPLOAD_KEY_ALIAS', 'TXILLAPP_UPLOAD_KEY_PASSWORD']);
  // Lê do ambiente e, se não houver, das propriedades do Gradle (gradle.properties do utilizador, fora do git).
  assert.match(out, /System\.getenv\(k\) \?: \(project\.hasProperty\(k\) \? project\.property\(k\)\?\.toString\(\) : null\)/);
  assert.ok(out.indexOf('def txillappUploadReady') < out.indexOf('android {'), 'a leitura fica antes do bloco android');
  // O signingConfig release existe e só se preenche com tudo definido.
  assert.match(out, /signingConfigs \{\n\s+\/\/ >>> txillapp[^\n]*\n\s+release \{\n\s+if \(txillappUploadReady\) \{/);
  for (const k of KEYS) assert.match(out, new RegExp(`txillappUpload\\('${k}'\\)`));
  // O buildType release escolhe; o debug fica com a chave debug.
  const rel = out.slice(out.search(/^\s+buildTypes \{/m));
  assert.match(rel, /release \{\n[^}]*signingConfig txillappUploadReady \? signingConfigs\.release : signingConfigs\.debug/);
  assert.match(rel, /debug \{\n\s+signingConfig signingConfigs\.debug\n/);
  // Sem segredos: nenhuma senha escrita no ficheiro além da conhecida da chave debug.
  assert.equal((out.match(/storePassword '/g) ?? []).length, 1);
  assert.equal((out.match(/keyPassword '/g) ?? []).length, 1);
});

test('aplicar a assinatura duas vezes dá o mesmo ficheiro (o prebuild sem --clean corre os plugins outra vez)', () => {
  const { applySigning } = require('../plugins/withAndroidUploadSigning.js');
  const once = applySigning(GRADLE);
  assert.equal(applySigning(once), once);
  assert.equal((once.match(/>>> txillapp: chave de upload/g) ?? []).length, 2);
  assert.ok(appJson.plugins.includes('./plugins/withAndroidUploadSigning'));
});

test('as chaves e a pasta android/ gerada não vão para o git', () => {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^\*\.jks$/m);
  assert.match(gi, /^\/android$/m);
});

// ---------- 5. Identidade da app, versão e arranque ----------

test('pacote, nome, versão e ícone adaptativo para a Play Console', () => {
  assert.equal(android.package, 'com.txillapp.app');
  assert.equal(appJson.name, 'Txillapp');
  assert.match(appJson.version, /^\d+\.\d+\.\d+$/); // versionName
  assert.ok(Number.isInteger(android.versionCode) && android.versionCode > 0); // tem de subir a cada envio
  for (const k of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
    assert.ok(existsSync(path.join(ROOT, android.adaptiveIcon[k])), `ícone adaptativo: ${k}`);
  }
  assert.ok(existsSync(path.join(ROOT, appJson.icon)));
});

test('a app aponta para o servidor a sério, sem endereços de desenvolvimento', () => {
  assert.match(src('lib/config.ts'), /'https:\/\/txillapp\.com'/);
  for (const f of ['lib/config.ts', 'lib/api.ts', 'lib/auth.tsx', 'lib/calls/webrtc.ts', 'lib/realtime.ts']) {
    if (!existsSync(path.join(ROOT, 'src', ...f.split('/')))) continue;
    assert.doesNotMatch(src(f), /10\.0\.2\.2|localhost:\d|192\.168\.|http:\/\/(?!www\.w3\.org)/, `${f} sem endereços de desenvolvimento`);
  }
});

test('sem sessão, a app leva ao login (e às páginas públicas) sem ecrãs de sessão', () => {
  const s = src('app/_layout.tsx');
  assert.match(s, /router\.replace\('\/login'\)/);
  // O que precisa de sessão só aparece com sessão.
  assert.match(s, /\{user \? <CallOverlay \/> : null\}/);
  assert.match(s, /\{user \? <PushReminderHost \/> : null\}/);
  // O pedido das notificações (Android 13+) só aparece no passo a passo depois de entrar, explicado.
  const p = src('components/PermissionsOnboarding.tsx');
  assert.match(p, /if \(Platform\.OS === 'web' \|\| !user\) return;/);
  assert.match(p, /id: 'notif'[^\n]*text: 'Para saberes logo/);
});
