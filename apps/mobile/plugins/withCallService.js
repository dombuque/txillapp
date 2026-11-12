/**
 * Põe no AndroidManifest da app o foreground service das chamadas (modules/call-service, CallService.kt) e as
 * permissões de que precisa:
 * - FOREGROUND_SERVICE e FOREGROUND_SERVICE_MICROPHONE: o microfone continua a funcionar com a app fora do ecrã;
 * - FOREGROUND_SERVICE_CAMERA: o mesmo para a câmara, nas videochamadas.
 * O tipo do <service> é "microphone|camera"; o serviço arranca só com "microphone", ou com os dois se a câmara estiver
 * ligada. No Google Play é o ÚNICO foreground service da app: os outros saem pelo plugins/withoutUnusedServices.js e
 * pelo "enableBackgroundPlayback": false do expo-audio. A declaração para a Play Console está em
 * docs/lojas/google-play.md.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SERVICE_NAME = 'com.txillapp.callservice.CallService';
const SERVICE_TYPES = 'microphone|camera';
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
];

function addCallService(manifest) {
  const root = manifest.manifest;
  root['uses-permission'] = root['uses-permission'] ?? [];
  for (const name of PERMISSIONS) {
    if (!root['uses-permission'].some((p) => p.$?.['android:name'] === name)) root['uses-permission'].push({ $: { 'android:name': name } });
  }
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const others = (app.service ?? []).filter((s) => s.$?.['android:name'] !== SERVICE_NAME);
  app.service = [
    ...others,
    {
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'false',
        'android:foregroundServiceType': SERVICE_TYPES,
        'android:stopWithTask': 'true',
      },
    },
  ];
  return manifest;
}

const withCallService = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = addCallService(cfg.modResults);
    return cfg;
  });

module.exports = withCallService;
module.exports.addCallService = addCallService;
module.exports.SERVICE_NAME = SERVICE_NAME;
module.exports.SERVICE_TYPES = SERVICE_TYPES;
module.exports.PERMISSIONS = PERMISSIONS;
