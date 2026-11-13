/**
 * Android 8 (API 26) como mínimo. A Skia só compila o vídeo (`Skia.Video`, que dá o filtro completo aos vídeos na
 * pré-visualização do estúdio das tchekas) quando a app é compilada com minSdk 26 ou mais: abaixo disso o código fica
 * de fora do librnskia.so e qualquer vídeo falha com «Skia Videos are only support on API 26 and above», mesmo em
 * telemóveis recentes. Quem ainda tem Android 7 fica com a versão que já instalou.
 */
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withMinSdk26(config) {
  return withGradleProperties(config, (c) => {
    const props = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'android.minSdkVersion'));
    props.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    c.modResults = props;
    return c;
  });
};
