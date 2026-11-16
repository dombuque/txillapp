// Correções a módulos nativos em node_modules, aplicadas depois de cada `npm install` (postinstall) e antes da APK.
// Idempotente: se já estiver aplicada, não faz nada; se o código do módulo mudar, avisa e não mexe.
//
// expo-image-picker (Android): ao escolher um vídeo da galeria, o módulo lê largura, altura, rotação e duração com o
// MediaMetadataRetriever e, se o telemóvel não der uma delas (acontece em alguns Xiaomi/Android e vídeos de outras apps,
// sobretudo a rotação), atirava «Failed to extract metadata from video file» e a galeria não abria nada. Agora o que faltar
// fica 0: a app não usa a largura/altura daqui, a duração 0 conta como desconhecida e o servidor mede o vídeo a sério.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));

function pkgDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const patches = [
  {
    pkg: 'expo-image-picker',
    file: 'android/src/main/java/expo/modules/imagepicker/ImagePickerUtils.kt',
    from: 'return this.extractMetadata(key)?.toInt() ?: throw FailedToExtractVideoMetadataException()',
    to: 'return this.extractMetadata(key)?.trim()?.toDoubleOrNull()?.toInt() ?: 0 // txillapp: patch-native.mjs',
  },
];

let failed = false;
for (const p of patches) {
  const dir = pkgDir(p.pkg);
  if (!dir) continue;
  const f = path.join(dir, p.file);
  if (!existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  if (s.includes(p.to)) continue;
  if (!s.includes(p.from)) {
    console.warn(`[patch-native] ${p.pkg}: o código mudou, não apliquei a correção (${p.file})`);
    failed = true;
    continue;
  }
  writeFileSync(f, s.replace(p.from, p.to));
  console.log(`[patch-native] ${p.pkg}: correção aplicada`);
}
if (failed && process.argv.includes('--strict')) process.exit(1);
