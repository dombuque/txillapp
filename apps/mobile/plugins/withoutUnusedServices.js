/**
 * Tira do AndroidManifest final os serviços em primeiro plano (foreground services) que vêm nos módulos mas que o
 * Txillapp não usa. Desde o Android 14 cada foreground service tem de ter um tipo e, no Google Play, uma declaração na
 * Play Console (com vídeo) a explicar para que serve; um serviço que a app nunca arranca só dá trabalho e motivo de
 * recusa. Ficam com tools:node="remove", que o Gradle aplica ao juntar os manifestos dos módulos.
 *
 * - react-native-webrtc: MediaProjectionService (partilhar o ecrã numa chamada; o Txillapp não tem isso).
 * - expo-location: LocationTaskService e LocationForegroundService (localização em segundo plano; o Txillapp só usa
 *   a localização com a app aberta: watchPositionAsync / getCurrentPositionAsync).
 * O AudioControlsService do expo-audio (controlos no ecrã bloqueado) sai com "enableBackgroundPlayback": false no app.json.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const UNUSED_SERVICES = [
  'com.oney.WebRTCModule.MediaProjectionService',
  'expo.modules.location.services.LocationTaskService',
  'expo.modules.location.next.locationForegroundService.LocationForegroundService',
];

function removeServices(manifest) {
  manifest.manifest.$ = manifest.manifest.$ ?? {};
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('withoutUnusedServices: o AndroidManifest não tem <application>');
  const others = (app.service ?? []).filter((s) => !UNUSED_SERVICES.includes(s.$?.['android:name']));
  app.service = [...others, ...UNUSED_SERVICES.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } }))];
  return manifest;
}

const withoutUnusedServices = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = removeServices(cfg.modResults);
    return cfg;
  });

module.exports = withoutUnusedServices;
module.exports.removeServices = removeServices;
module.exports.UNUSED_SERVICES = UNUSED_SERVICES;
