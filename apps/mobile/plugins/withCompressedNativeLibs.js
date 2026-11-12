/**
 * O APK beta (do site) com as bibliotecas nativas comprimidas: cerca de 88 MB em vez de 200 MB. Um `prebuild --clean`
 * repunha `expo.useLegacyPackaging=false` no android/gradle.properties e o APK mais do que duplicava. No Google Play vai
 * um .aab, e a loja escolhe como as entrega, por isso não faz mal ligar isto também lá.
 */
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withCompressedNativeLibs(config) {
  return withGradleProperties(config, (c) => {
    const props = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'expo.useLegacyPackaging'));
    props.push({ type: 'property', key: 'expo.useLegacyPackaging', value: 'true' });
    c.modResults = props;
    return c;
  });
};
