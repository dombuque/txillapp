// Versão da App Store (docs/lojas/app-store.md): o que a revisão da Apple verifica e já ficou tratado no código e no
// app.json. Regras puras em src/lib/storeRules.ts; o resto lê os ficheiros.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onboardingSteps, prePromptButtons, askButtonLabel, googleSignInAllowed, showComingSoon } from '../src/lib/storeRules.ts';
import { permissionView } from '../src/lib/cameraControls.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const plugin = (name) => {
  const p = app.plugins.find((x) => (Array.isArray(x) ? x[0] : x) === name);
  return Array.isArray(p) ? p[1] : p ? {} : undefined;
};

test('5.1.1(iv): na App Store o arranque só pede as notificações, com «Continuar» e sem «Agora não»', () => {
  assert.deepEqual(onboardingSteps('appstore'), ['notif']);
  assert.deepEqual(onboardingSteps('beta'), ['notif', 'camera', 'photos', 'location']);
  assert.deepEqual(onboardingSteps('play'), ['notif', 'camera', 'photos', 'location']);
  assert.deepEqual(prePromptButtons('appstore'), { primary: 'Continuar', later: null });
  assert.deepEqual(prePromptButtons('beta'), { primary: 'Permitir', later: 'Agora não' });
  const src = read('src/components/PermissionsOnboarding.tsx');
  assert.match(src, /onboardingSteps\(CHANNEL\)/);
  assert.match(src, /\{BUTTONS\.primary\}/);
  assert.doesNotMatch(src, />Permitir</);
  assert.doesNotMatch(src, />Agora não</);
});

test('5.1.1(iv): no iPhone os botões que levam ao pedido do sistema dizem «Continuar»', () => {
  assert.equal(askButtonLabel('ios', 'Permitir a galeria'), 'Continuar');
  assert.equal(askButtonLabel('android', 'Permitir a galeria'), 'Permitir a galeria');
  assert.equal(permissionView('not-determined', false, 'ios').label, 'Continuar');
  assert.equal(permissionView('not-determined').label, 'Permitir a câmara');
  assert.equal(permissionView('denied', false, 'ios').label, 'Abrir definições');
  assert.match(read('src/components/NativeCamera.tsx'), /permissionView\(perm\.status, refused, PLATFORM\)/);
  assert.match(read('src/components/GalleryPicker.tsx'), /askButtonLabel\(Platform\.OS, 'Permitir a galeria'\)/);
});

test('4.8: o «Entrar com Google» só aparece na web, nunca na versão da App Store', () => {
  assert.equal(googleSignInAllowed('ios', 'appstore'), false);
  assert.equal(googleSignInAllowed('ios', 'beta'), false);
  assert.equal(googleSignInAllowed('android', 'play'), false);
  assert.equal(googleSignInAllowed('web', 'web'), true);
  assert.match(read('src/components/GoogleButton.tsx'), /if \(!googleSignInAllowed\(Platform\.OS, CHANNEL\)\) return null;/);
});

test('2.1/2.2: nas lojas não há «em breve» no ecrã do idioma', () => {
  assert.equal(showComingSoon('appstore'), false);
  assert.equal(showComingSoon('play'), false);
  assert.equal(showComingSoon('web'), true);
  const src = read('src/app/language.tsx');
  assert.match(src, /const SOON = showComingSoon\(CHANNEL\)/);
  assert.match(src, /\{SOON \? <Line icon="globe" label="English"/);
});

test('2.3.10: o aviso de nova versão (APK) só corre no Android', () => {
  const src = read('src/components/AppUpdate.tsx');
  assert.match(src, /if \(Platform\.OS !== 'android'\) return;/);
});

test('Info.plist: textos de permissão em português, sem os textos ingleses do Expo nem permissões que a app não usa', () => {
  const ip = app.ios.infoPlist;
  assert.equal(app.ios.supportsTablet, false);
  assert.match(ip.NSLocationWhenInUseUsageDescription, /^O Txillapp usa a tua localização/);
  assert.deepEqual(ip.UIBackgroundModes, ['audio']); // só o áudio das chamadas (ver docs/lojas/app-store.md)
  assert.deepEqual(ip.NSAppTransportSecurity, { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true });
  assert.equal(ip.NSUserTrackingUsageDescription, undefined); // sem rastreio: sem ATT
  assert.equal(ip.NSContactsUsageDescription, undefined); // os contactos só existem na web
  assert.deepEqual(app.ios.entitlements, { 'com.apple.developer.usernotifications.time-sensitive': true });
  const cam = plugin('expo-camera');
  assert.match(cam.cameraPermission, /^O Txillapp usa a câmara .*videochamadas.*verificação/);
  assert.match(cam.microphonePermission, /^O Txillapp usa o microfone .*chamadas/);
  const media = plugin('expo-media-library');
  assert.match(media.photosPermission, /^O Txillapp mostra as tuas fotos/);
  assert.match(media.savePhotosPermission, /^O Txillapp guarda/);
  const loc = plugin('expo-location');
  assert.ok(loc, 'expo-location tem de estar nos plugins (senão entra com os textos ingleses do Expo)');
  assert.equal(loc.motionUsagePermission, false);
  assert.equal(loc.isIosBackgroundLocationEnabled, false);
  for (const k of ['locationWhenInUsePermission', 'locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission', 'locationFullAccuracyPermission']) {
    assert.match(loc[k], /^O Txillapp /, k);
  }
  assert.equal(plugin('expo-secure-store').faceIDPermission, false);
  assert.doesNotMatch(JSON.stringify(app), /Allow \$\(PRODUCT_NAME\)/);
});

test('Privacy manifest: sem rastreio e com as razões das Required Reason APIs que o Expo/RN usam', () => {
  const pm = app.ios.privacyManifests;
  assert.equal(pm.NSPrivacyTracking, false);
  assert.deepEqual(pm.NSPrivacyTrackingDomains, []);
  const reasons = Object.fromEntries(pm.NSPrivacyAccessedAPITypes.map((t) => [t.NSPrivacyAccessedAPIType.replace('NSPrivacyAccessedAPICategory', ''), t.NSPrivacyAccessedAPITypeReasons]));
  assert.deepEqual(reasons.UserDefaults, ['CA92.1']);
  assert.ok(reasons.FileTimestamp.includes('C617.1'));
  assert.deepEqual(reasons.SystemBootTime, ['35F9.1']);
  assert.ok(reasons.DiskSpace.includes('E174.1'));
});

test('5.1.2: sem SDKs de anúncios, análise ou rastreio de terceiros', () => {
  const deps = Object.keys(JSON.parse(read('package.json')).dependencies);
  const bad = deps.filter((d) => /firebase|analytics|segment|amplitude|mixpanel|appsflyer|adjust|branch|facebook|fbsdk|admob|ads|sentry|bugsnag|tracking-transparency|onesignal/i.test(d));
  assert.deepEqual(bad, []);
});

test('2.1/2.5: sem endereços de desenvolvimento no código da app', () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const hits = files.filter((f) => /10\.0\.2\.2|127\.0\.0\.1|https?:\/\/localhost|192\.168\.\d/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
  assert.match(read('src/lib/config.ts'), /'https:\/\/txillapp\.com'/);
});

test('ícone da App Store: 1024×1024 sem transparência (PNG RGB, sem canal alfa)', () => {
  const b = readFileSync(path.join(ROOT, app.icon));
  assert.equal(b.toString('ascii', 12, 16), 'IHDR');
  assert.equal(b.readUInt32BE(16), 1024);
  assert.equal(b.readUInt32BE(20), 1024);
  assert.equal(b[25], 2); // tipo de cor 2 = RGB (6 seria RGBA)
  assert.ok(!b.includes(Buffer.from('tRNS')));
});
