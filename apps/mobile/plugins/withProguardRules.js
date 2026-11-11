/**
 * Regras do R8 (APK de release com minify) que têm de sobreviver a um `expo prebuild --clean`: acrescenta-as ao
 * android/app/proguard-rules.pro gerado, entre marcas, sem as repetir quando o prebuild corre outra vez.
 *
 * react-native-webrtc: as classes org.webrtc (e o jni_zero / J.N das versões novas do libwebrtc) são chamadas pelo código
 * nativo por JNI; o módulo da ponte (com.oney.WebRTCModule) é guardado inteiro para o R8 não lhe mexer (só inlining,
 * mas assim fica igual ao que corre em dev).
 *
 * react-native-vision-camera 5 / react-native-nitro-modules / react-native-nitro-image: não trazem consumer-rules.pro
 * nenhum (minifyEnabled false nos três). O C++ do Nitro cria por JNI, pelo nome, as classes Kotlin
 * (ex.: "Lcom/margelo/nitro/camera/VisionCamera;", HybridObject$CxxPart, Promise$OnResolvedCallback, os structs como
 * FocusOptions) e lê/chama campos e métodos pelo nome. Quase tudo tem @Keep/@DoNotStrip, mas as implementações
 * (HybridCameraController, HybridVideoRecorder…) não: se o R8 as renomear ou cortar, a câmara rebenta ao abrir só na
 * APK de release. Guarda-se o pacote inteiro (custa poucos KB).
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const START = '# >>> txillapp: regras extra (plugins/withProguardRules.js)';
const END = '# <<< txillapp';

const RULES = [
  '# react-native-webrtc',
  '-keep class org.webrtc.** { *; }',
  '-dontwarn org.webrtc.**',
  '-keep class org.jni_zero.** { *; }',
  '-keep class J.N { *; }',
  '-dontwarn org.jni_zero.**',
  '-keep class com.oney.WebRTCModule.** { *; }',
  '# react-native-vision-camera 5 + react-native-nitro-modules + react-native-nitro-image (Nitro: JNI pelo nome)',
  '-keep class com.margelo.nitro.** { *; }',
  '-keep interface com.margelo.nitro.** { *; }',
  '-keep enum com.margelo.nitro.** { *; }',
  '-dontwarn com.margelo.nitro.**',
];

module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const a = text.indexOf(START);
      const b = text.indexOf(END);
      if (a >= 0 && b > a) text = text.slice(0, a) + text.slice(b + END.length);
      text = `${text.trimEnd()}\n\n${START}\n${RULES.join('\n')}\n${END}\n`;
      fs.writeFileSync(file, text);
      return cfg;
    },
  ]);
};
