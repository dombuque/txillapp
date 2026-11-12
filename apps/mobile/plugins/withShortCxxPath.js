/**
 * No Windows, o ninja do CMake 3.22 não aceita caminhos com mais de 260 caracteres, e o C++ do reanimated (e de outros
 * módulos) gera pastas de objetos que repetem o caminho inteiro do projeto. Num `prebuild --clean` a compilação parava em
 * `mkdir(...): No such file or directory`. Isto põe as pastas temporárias do CMake de cada módulo num caminho curto
 * (C:\cx\<módulo>) e usa o CMake 3.31.6 (o ninja 1.12 aceita caminhos longos), só quando a compilação corre no Windows. Noutros sistemas não muda nada.
 */
const { withSettingsGradle } = require('expo/config-plugins');

const START = '// >>> txillapp: CMake em caminho curto no Windows (plugins/withShortCxxPath.js)';
const END = '// <<< txillapp: CMake em caminho curto';
const BLOCK = `${START}
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
  gradle.beforeProject { p ->
    p.plugins.withId('com.android.library') {
      p.android.externalNativeBuild.cmake.buildStagingDirectory = new File("C:/cx/\${p.name}")
      p.android.externalNativeBuild.cmake.version = "3.31.6"
    }
    p.plugins.withId('com.android.application') {
      p.android.externalNativeBuild.cmake.buildStagingDirectory = new File("C:/cx/\${p.name}")
      p.android.externalNativeBuild.cmake.version = "3.31.6"
    }
  }
}
${END}`;

function addBlock(contents) {
  const start = contents.indexOf(START);
  if (start >= 0) {
    const end = contents.indexOf(END, start);
    if (end >= 0) return contents.slice(0, start) + BLOCK + contents.slice(end + END.length);
  }
  return `${contents.trimEnd()}\n\n${BLOCK}\n`;
}

module.exports = function withShortCxxPath(config) {
  return withSettingsGradle(config, (c) => {
    if (c.modResults.language === 'groovy') c.modResults.contents = addBlock(c.modResults.contents);
    return c;
  });
};
module.exports.addBlock = addBlock;
