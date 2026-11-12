/**
 * Assinatura do APK/AAB de release com a chave de upload do Google Play, sem segredos no repositório.
 *
 * O android/app/build.gradle gerado pelo `expo prebuild` assina o release com a chave debug (a do APK beta). Este plugin
 * acrescenta um signingConfig "release" que lê a keystore, as senhas e o alias:
 *   1. das variáveis de ambiente TXILLAPP_UPLOAD_STORE_FILE, TXILLAPP_UPLOAD_STORE_PASSWORD,
 *      TXILLAPP_UPLOAD_KEY_ALIAS e TXILLAPP_UPLOAD_KEY_PASSWORD; ou, se não houver,
 *   2. das propriedades do Gradle com os mesmos nomes, num gradle.properties FORA do git
 *      (o do utilizador: %USERPROFILE%\.gradle\gradle.properties, ou ~/.gradle/gradle.properties).
 * Só quando não há nada disto é que o release continua com a chave debug (o APK beta de sempre), com um aviso no build.
 * O Google Play recusa um .aab assinado com a chave debug.
 *
 * Como gerar a chave e fazer o bundleRelease: docs/lojas/google-play.md.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const START = '// >>> txillapp: chave de upload (plugins/withAndroidUploadSigning.js)';
const END = '// <<< txillapp: chave de upload';

const KEYS = ['TXILLAPP_UPLOAD_STORE_FILE', 'TXILLAPP_UPLOAD_STORE_PASSWORD', 'TXILLAPP_UPLOAD_KEY_ALIAS', 'TXILLAPP_UPLOAD_KEY_PASSWORD'];

/** Lê a configuração (ambiente primeiro, depois gradle.properties) e diz se está completa. Fica antes do bloco android {}. */
const HEADER = [
  START,
  'def txillappUpload = { String k -> System.getenv(k) ?: (project.hasProperty(k) ? project.property(k)?.toString() : null) }',
  `def txillappUploadReady = [${KEYS.map((k) => `'${k}'`).join(', ')}].every { txillappUpload(it) }`,
  'if (!txillappUploadReady) {',
  '    logger.warn("txillapp: sem chave de upload (TXILLAPP_UPLOAD_*): o release vai assinado com a chave debug. Serve para o APK beta, o Google Play recusa-o.")',
  '}',
  END,
].join('\n');

/** O signingConfig "release", dentro de signingConfigs {}. */
const SIGNING = [
  `        ${START}`,
  '        release {',
  '            if (txillappUploadReady) {',
  "                storeFile file(txillappUpload('TXILLAPP_UPLOAD_STORE_FILE'))",
  "                storePassword txillappUpload('TXILLAPP_UPLOAD_STORE_PASSWORD')",
  "                keyAlias txillappUpload('TXILLAPP_UPLOAD_KEY_ALIAS')",
  "                keyPassword txillappUpload('TXILLAPP_UPLOAD_KEY_PASSWORD')",
  '            }',
  '        }',
  `        ${END}`,
].join('\n');

const RELEASE_USES = 'signingConfig txillappUploadReady ? signingConfigs.release : signingConfigs.debug';

/** Tira o que um prebuild anterior tenha posto (o prebuild sem --clean volta a correr os plugins sobre o mesmo ficheiro). */
function strip(text) {
  let out = text;
  for (;;) {
    const a = out.indexOf(START);
    if (a < 0) break;
    const b = out.indexOf(END, a);
    if (b < 0) break;
    const lineStart = out.lastIndexOf('\n', a) + 1;
    let cut = out.indexOf('\n', b);
    cut = cut < 0 ? out.length : cut + 1;
    // O bloco de cima (na coluna 0) leva uma linha em branco a seguir: sai com ele.
    if (a === lineStart && out[cut] === '\n') cut += 1;
    out = out.slice(0, lineStart) + out.slice(cut);
  }
  return out.replace(RELEASE_USES, 'signingConfig signingConfigs.debug');
}

function applySigning(gradle) {
  let text = strip(gradle);
  const android = text.search(/^android\s*\{/m);
  if (android < 0) throw new Error('withAndroidUploadSigning: não encontrei o bloco android {} no app/build.gradle');
  text = `${text.slice(0, android)}${HEADER}\n\n${text.slice(android)}`;

  const sc = text.search(/^\s*signingConfigs\s*\{/m);
  if (sc < 0) throw new Error('withAndroidUploadSigning: não encontrei signingConfigs {} no app/build.gradle');
  const open = text.indexOf('{', sc) + 1;
  text = `${text.slice(0, open)}\n${SIGNING}${text.slice(open)}`;

  // No buildTypes.release: troca o "signingConfig signingConfigs.debug" (o do release, não o do debug).
  const bt = text.search(/^\s*buildTypes\s*\{/m);
  const rel = bt < 0 ? -1 : text.slice(bt).search(/^\s*release\s*\{/m);
  if (rel < 0) throw new Error('withAndroidUploadSigning: não encontrei buildTypes { release {} } no app/build.gradle');
  const relAt = bt + rel;
  const use = text.indexOf('signingConfig signingConfigs.debug', relAt);
  if (use < 0) throw new Error('withAndroidUploadSigning: o release do app/build.gradle já não assina com signingConfigs.debug');
  text = text.slice(0, use) + RELEASE_USES + text.slice(use + 'signingConfig signingConfigs.debug'.length);
  return text;
}

const withAndroidUploadSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') throw new Error('withAndroidUploadSigning: só sei mexer no build.gradle em Groovy');
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });

module.exports = withAndroidUploadSigning;
module.exports.applySigning = applySigning;
module.exports.KEYS = KEYS;
