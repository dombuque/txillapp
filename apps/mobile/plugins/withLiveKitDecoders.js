/**
 * Android: os vídeos que chegam pelo WebRTC (a Txillada de quem vê, as videochamadas) descodificam-se em software para
 * VP8, VP9 e AV1; só o H.264 usa o descodificador do telemóvel. É o que o react-native-webrtc faz por omissão
 * (H264AndSoftwareVideoDecoderFactory, igual ao iPhone), mas o LiveKitReactNative.setup (chamado pelo
 * @livekit/react-native-expo-plugin) troca-o por um que põe o descodificador do aparelho à frente em tudo. Os
 * descodificadores VP8 dos aparelhos são os menos fiáveis (cada fabricante tem o seu): quando falham, os frames chegam,
 * são «desenhados» e o ecrã de quem vê fica preto, sem erro nenhum. O VP8 é o que o site (e o PWA no iPhone) transmite.
 *
 * Como o MainApplication é gerado (prebuild), a troca entra aqui, logo a seguir ao setup da LiveKit
 * (ApplicationLifecycleDispatcher.onApplicationCreate) e antes de o WebRTCModule ler as opções (só ao primeiro uso).
 *
 * Para comparar num telemóvel (diagnóstico): `adb shell setprop debug.txill.hwdec 1` e reabrir a app volta a pôr o
 * descodificador do aparelho; `adb shell setprop debug.txill.hwdec 0` (ou reiniciar o telemóvel) volta ao software.
 */
const { withMainApplication } = require('expo/config-plugins');

const MARK = '// txillapp: descodificadores do WebRTC (plugins/withLiveKitDecoders.js)';
const LINES = [
  `    ${MARK}`,
  '    val txHwDecoders = try {',
  '      Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, "debug.txill.hwdec") == "1"',
  '    } catch (e: Exception) { false }',
  '    if (!txHwDecoders) {',
  '      (com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().videoDecoderFactory as? com.livekit.reactnative.video.CustomVideoDecoderFactory)',
  '        ?.setForceSWCodecList(listOf("VP8", "VP9", "AV1"))',
  '    }',
];

module.exports = function withLiveKitDecoders(config) {
  return withMainApplication(config, (c) => {
    if (c.modResults.language !== 'kt') throw new Error('withLiveKitDecoders: o MainApplication não é Kotlin');
    let src = c.modResults.contents;
    if (src.includes(MARK)) return c;
    const anchor = 'ApplicationLifecycleDispatcher.onApplicationCreate(this)';
    const at = src.indexOf(anchor);
    if (at < 0) throw new Error('withLiveKitDecoders: não encontrei o ApplicationLifecycleDispatcher.onApplicationCreate no MainApplication');
    const end = src.indexOf('\n', at);
    src = `${src.slice(0, end + 1)}${LINES.join('\n')}\n${src.slice(end + 1)}`;
    c.modResults.contents = src;
    return c;
  });
};
