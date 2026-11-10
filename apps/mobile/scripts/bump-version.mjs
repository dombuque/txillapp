// Sobe a versão da app (Semantic Versioning: MAJOR.MINOR.PATCH) em app.json e package.json, e o android.versionCode em +1.
//   node scripts/bump-version.mjs patch   → correções (1.1.0 → 1.1.1)
//   node scripts/bump-version.mjs minor   → funcionalidades novas (1.1.1 → 1.2.0)
//   node scripts/bump-version.mjs major   → mudanças que partem compatibilidade (1.2.0 → 2.0.0)
//   node scripts/bump-version.mjs 1.4.0   → uma versão à mão
// Imprime a versão nova; o deploy (docs/DEPLOY.md) faz commit, etiqueta git `vX.Y.Z` e publica.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = join(root, 'app.json');
const pkgPath = join(root, 'package.json');
const app = JSON.parse(readFileSync(appPath, 'utf8'));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const cur = String(app.expo?.version ?? pkg.version ?? '1.0.0');
const arg = process.argv[2] ?? 'patch';
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else {
  const [ma, mi, pa] = cur.split('.').map(Number);
  next = arg === 'major' ? `${ma + 1}.0.0` : arg === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
}
app.expo.version = next;
// O Android só aceita uma atualização com versionCode maior do que o instalado: sobe sempre 1.
app.expo.android.versionCode = (Number(app.expo.android.versionCode) || 0) + 1;
pkg.version = next;
writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(next);
