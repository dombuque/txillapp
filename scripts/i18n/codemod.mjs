#!/usr/bin/env node
// Codemod dos idiomas (docs: C:/dombuque/tmp-apk/idiomas-contrato.md): passa os textos visíveis da app por `t()`.
//
//   node scripts/i18n/codemod.mjs [--only src/app/settings ...] [--dry] [--report <ficheiro.md>] [--list]
//
// Lê apps/mobile com o compilador do TypeScript (com o verificador de tipos, para saber o que é texto) e reescreve cada
// ficheiro a partir da árvore, copiando à letra tudo o que não muda (comentários, espaços, fins de linha CRLF/LF).
//
// O que transforma (só quando parece texto português visível):
//   - texto JSX entre tags, com as expressões de texto/número pelo meio como `{nome}`  →  {t('Olá {nome}', { nome })}
//   - literais em props visíveis (title, label, placeholder, accessibilityLabel…), em propriedades visíveis de objetos
//     ({ text: 'Cancelar' }), em chamadas visíveis (Alert.alert, setErr, showToast…), e nos `return`/variáveis com nome
//     de texto quando a frase é claramente prosa
//   - literais de template e concatenações  →  t('… {x} …', { x })
//   - plural evidente `${n} ${n === 1 ? 'brinde' : 'brindes'}`  →  t('{count} brinde', { count: n, other: '{count} brindes' })
//   - textos em constantes do módulo: a propriedade passa a getter (`get label() { return t('…') }`) e as constantes só
//     usadas dentro de funções passam a função (`const X = () => …`, e `X` → `X()`), para não ficarem no idioma do arranque
// O que não toca: chaves, ids, rotas, ícones, estilos, URLs, testIDs, tipos literais, comparações, regex, o que já está
// em t(), comentários, src/lib/legalText.ts, os termos do glossário sozinhos e os emojis.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'apps/mobile');
const require = createRequire(path.join(APP, 'package.json'));
const ts = require('typescript');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = args.flatMap((a, i) => (args[i - 1] === '--only' ? [a.replace(/\\/g, '/').replace(/\/$/, '')] : []));
const DRY = args.includes('--dry');
const LIST = args.includes('--list');
const REPORT = opt('--report') ?? 'C:/dombuque/tmp-apk/codemod-relatorio.md';
const LOG_JSON = REPORT.replace(/\.md$/, '.json');

const EXCLUDE_FILES = [/\/src\/lib\/legalText\.ts$/, /\/src\/lib\/i18n\.ts$/, /\/src\/icons\//, /\.d\.ts$/];
const GLOSSARY = (() => {
  const p = path.join(ROOT, 'scripts/i18n/glossary.json');
  const base = ['Txillapp', 'Txillada', 'Txilladas', 'mimo', 'mimos', 'tchekas', 'tcheka', 'Zás', 'vibes', 'vib', 'Mixar', 'geleira', 'gelada', 'geladas', 'TxillGroup', 'TxillGroups', 'SuperTxill', 'Paga-me uma', 'malta'];
  try { const g = JSON.parse(fs.readFileSync(p, 'utf8')); const list = Array.isArray(g) ? g : g.terms ?? Object.keys(g); return new Set([...base, ...list].map((s) => String(s).toLowerCase())); } catch { return new Set(base.map((s) => s.toLowerCase())); }
})();
/** Textos visíveis que não são português e ficam como estão (marca, slogans). */
const KEEP_AS_IS = new Set(['Txill with the crew', 'OK', 'Ok', 'GIF', 'QR', 'PIN', 'Wi-Fi', 'Google', 'Apple', 'WhatsApp', 'Instagram', 'TikTok', 'Facebook', 'Spotify', 'YouTube', 'M-Pesa', 'e-Mola', 'mKesh', 'Emola', 'iOS', 'Android', 'Safari', 'Chrome']);

// ── contextos ────────────────────────────────────────────────────────────────────────────────────────────────────────
const VIS_ATTR = new Set(['accessibilityLabel', 'accessibilityHint', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'label', 'title', 'placeholder', 'text', 'sub', 'subtitle', 'hint', 'description', 'message', 'confirm', 'cancel', 'what', 'a11y', 'intro', 'note', 'line', 'heading', 'caption', 'tooltip', 'alt', 'cta', 'empty', 'lead', 'tip', 'question', 'detail', 'headline']);
const NONVIS_ATTR = new Set(['d', 'transform', 'name', 'viewBox', 'key', 'testID', 'nativeID', 'style', 'href', 'source', 'icon', 'color', 'tint', 'tintColor', 'type', 'mode', 'variant', 'id', 'keyboardType', 'autoComplete', 'autoCapitalize', 'textContentType', 'returnKeyType', 'inputMode', 'enterKeyHint', 'accessibilityRole', 'role', 'pointerEvents', 'resizeMode', 'contentFit', 'fill', 'stroke', 'strokeDasharray', 'strokeLinecap', 'strokeLinejoin', 'fontFamily', 'fontWeight', 'className', 'src', 'uri', 'kind', 'tab', 'screen', 'route', 'to', 'as', 'lang', 'dir', 'rel', 'target', 'method', 'accept', 'capture', 'pattern', 'autoCorrect', 'importantForAccessibility', 'accessibilityLiveRegion', 'aria-live', 'aria-hidden', 'aria-modal', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'offset', 'stopColor', 'gradientTransform', 'gradientUnits', 'points', 'preserveAspectRatio', 'fontSize', 'textAnchor', 'alignmentBaseline', 'initialRouteName', 'mask', 'clipPath', 'filter', 'fillRule', 'clipRule', 'width', 'height', 'size', 'emoji', 'sound', 'value', 'defaultValue', 'contentInsetAdjustmentBehavior', 'keyboardShouldPersistTaps', 'keyboardDismissMode', 'barStyle', 'animation', 'presentation', 'position', 'align', 'justify', 'tone', 'kindSel', 'slug', 'username', 'url', 'link', 'path', 'html', 'mime', 'mimeType', 'accept', 'decoding', 'loading', 'crossOrigin', 'playsInline', 'preload', 'frameBorder', 'allow', 'sandbox', 'referrerPolicy', 'htmlFor', 'autoFocus', 'spellCheck', 'tabIndex', 'draggable']);
const VIS_PROP = new Set([...VIS_ATTR, 'msg', 'desc', 'q', 'a', 'dialogTitle', 'why', 'summary', 'mood', 'headerTitle', 'tabBarLabel', 'headerBackTitle', 'emptyText', 'answer', 'okLabel', 'confirmLabel', 'cancelLabel', 'doneLabel', 'openLabel', 'tagline', 'tips', 'lines']);
const NONVIS_PROP = new Set([...NONVIS_ATTR, 'value', 'bg', 'event', 'code', 'font', 'google', 'family', 'css', 'headers', 'Content-Type', 'Authorization', 'ext', 'format', 'locale', 'channel', 'queryKey', 'storageKey', 'file', 'filename', 'image', 'regex', 'category', 'group', 'tag', 'tags', 'scope', 'action', 'origin', 'host', 'state', 'level', 'tier', 'kindLabel', 'platform', 'store', 'sku', 'productId', 'currency', 'unit', 'shape', 'pattern', 'easing', 'curve', 'blend', 'layout', 'weight', 'family', 'face', 'palette', 'theme', 'bg', 'fg', 'accent', 'tint', 'mood_id', 'lottie', 'asset', 'assets', 'video', 'audio', 'poster', 'thumb', 'cover', 'avatar', 'track', 'artist', 'album', 'author', 'handle', 'user', 'displayName', 'firstName', 'lastName', 'city', 'country', 'address', 'venue', 'place']);
const CSS_PROP = /^(webkit|moz|ms)?(padding|margin|border|background|font|text[A-Z]|flex|align|justify|grid|scroll|overflow|transition|transform|animation|mask|box|min[A-Z]|max[A-Z]|outline|inset|clip|object|user[A-Z]|touch|will|mix|white|word|letter|line[A-Z]|vertical|z[A-Z]|zIndex|opacity|cursor|display|position|filter|backdrop|left|right|top|bottom|width|height|rotate|gap|content|shadow|tint|color|stroke|fill|aspect|resize|elevation|direction)/i;
const VIS_SUFFIX = /(Label|Title|Text|Hint|Message|Msg|Placeholder|Caption|Heading|Subtitle|Note|Tip|Desc|Description|Intro|Empty|Cta|Lead|Prompt|Question|Sub|Line|Error|Err|Toast|Notice|Warning|Body|Summary|Copy)$/;
const VIS_WORDS = new Set(['label', 'labels', 'title', 'titles', 'text', 'texts', 'txt', 'msg', 'message', 'messages', 'hint', 'hints', 'sub', 'subtitle', 'desc', 'description', 'caption', 'placeholder', 'err', 'error', 'errors', 'toast', 'note', 'notes', 'heading', 'cta', 'copy', 'aviso', 'texto', 'titulo', 'lead', 'line', 'lines', 'tip', 'tips', 'empty', 'intro', 'prompt', 'question', 'questions', 'ask', 'asks', 'greeting', 'greetings', 'word', 'words', 'phrase', 'phrases', 'frase', 'frases', 'notice', 'warn', 'warning', 'summary', 'reason', 'why', 'body', 'say', 'said', 'fail', 'failed', 'faq', 'help', 'headline', 'blurb', 'tagline', 'banner', 'motivo', 'pergunta', 'resposta', 'nome', 'aria', 'a11y', 'accessibility', 'speak', 'spoken', 'announce', 'status', 'explain', 'explanation', 'about', 'legend', 'unit', 'units', 'verb', 'plural', 'singular', 'ago', 'when', 'day', 'days', 'month', 'months', 'weekday', 'weekdays', 'relative', 'human', 'pretty', 'nice', 'readable', 'who', 'what', 'mood', 'recipe']);
const NONVIS_WORDS = new Set(['key', 'keys', 'id', 'ids', 'url', 'urls', 'uri', 'path', 'paths', 'href', 'route', 'routes', 'css', 'style', 'styles', 'font', 'fonts', 'svg', 'color', 'colors', 'regex', 're', 'rx', 'pattern', 'mime', 'type', 'types', 'icon', 'icons', 'emoji', 'emojis', 'query', 'sql', 'class', 'classes', 'selector', 'html', 'js', 'script', 'd', 'viewbox', 'event', 'events', 'channel', 'storage', 'prefix', 'sep', 'separator', 'format', 'fmt', 'locale', 'lang', 'mode', 'ext', 'tag', 'tags', 'slug', 'code', 'codes', 'token', 'secret', 'header', 'headers', 'endpoint', 'host', 'origin', 'domain', 'shadow', 'gradient', 'transition', 'easing', 'family', 'filename', 'file', 'dir', 'src', 'mask', 'shape', 'kinds', 'sku', 'product', 'cache', 'username', 'handle']);
const VIS_CALLS = new Set(['alert', 'confirm', 'showToast', 'toast', 'say', 'setErr', 'setError', 'setNote', 'setMsg', 'setMessage', 'setHint', 'setInfo', 'setWarn', 'setWarning', 'setNotice', 'setLabel', 'setTitle', 'setToast', 'setTip', 'setAviso', 'setFail', 'setFailed', 'setProblem', 'setSaved', 'setDone', 'setFeedback', 'setBanner', 'setReason', 'setCaption', 'setLine', 'setSub', 'setLead', 'setSubtitle', 'setHeadline', 'setPrompt', 'setQuestion', 'flash', 'fail', 'notify', 'announce', 'announceForAccessibility', 'prompt', 'confirmThen', 'confirmar', 'failMsg', 'errText', 'setErrText', 'setErrorText', 'setStatusText', 'onError', 'setExplain', 'warnUser', 'tellUser']);
const NONVIS_CALLS = new Set(['require', 'import', 'log', 'warn', 'info', 'debug', 'error', 'trace', 'fetch', 'raw', 'api', 'get', 'post', 'put', 'patch', 'del', 'delete', 'replace', 'navigate', 'openURL', 'canOpenURL', 'addEventListener', 'removeEventListener', 'querySelector', 'querySelectorAll', 'getElementById', 'createElement', 'createElementNS', 'setAttribute', 'getAttribute', 'removeAttribute', 'setProperty', 'getPropertyValue', 'matchMedia', 'injectJavaScript', 'postMessage', 'emit', 'on', 'off', 'once', 'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'split', 'replaceAll', 'match', 'matchAll', 'test', 'search', 'RegExp', 'Symbol', 'Date', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'DateTimeFormat', 'NumberFormat', 'RelativeTimeFormat', 'PluralRules', 'padStart', 'padEnd', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'parse', 'stringify', 'getItem', 'setItem', 'removeItem', 'getItemAsync', 'setItemAsync', 'deleteItemAsync', 'track', 'logEvent', 'capture', 'create', 'select', 'useQuery', 'invalidateQueries', 'setQueryData', 'getQueryData', 'removeQueries', 'cancelQueries', 'refetchQueries', 'addColorStop', 'measureText', 'URL', 'URLSearchParams', 'has', 'set', 'add', 'clearTimeout', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Number', 'parseInt', 'parseFloat', 'BigInt', 'atob', 'btoa', 'Blob', 'File', 'FormData', 'append', 'Headers', 'Request', 'Response', 'Worker', 'importScripts', 'execCommand', 'canPlayType', 'isTypeSupported', 'getContext', 'toDataURL', 'toBlob', 'createObjectURL', 'Audio', 'Image', 'Event', 'CustomEvent', 'dispatchEvent', 'mark', 'measure', 'useLocalSearchParams', 'useSegments', 'Redirect', 'href', 'reportError', 'reportRenderError', 'setStatus', 'setMode', 'setKind', 'setTab', 'setStep', 'setFilter', 'setSort', 'setView', 'setPhase', 'setState', 'setSel', 'setType', 'setPick', 'setChoice', 'setLang', 'setSearch', 'setQuery', 'setTerm', 'setText', 'setValue', 'setDraft', 'setBody', 'setName', 'setCaptionText', 'localeCompare', 'normalize', 'toLowerCase', 'toUpperCase', 'trim', 'concat', 'charAt', 'at', 'slice', 'substring', 'repeat', 'sendMessage', 'send', 'write', 'writeText', 'setStringAsync', 'copy', 'share', 'shareAsync', 'speak', 'playSound', 'Haptics', 'impactAsync', 'notificationAsync', 'selectionAsync', 'scheduleNotificationAsync', 'setNotificationChannelAsync', 'setNotificationCategoryAsync', 'getPermissionsAsync', 'createChannel', 'assert', 'fillText', 'strokeText', 'font', 'loadAsync', 'Font', 'FontFace', 'insertRule', 'hash', 'digest', 'openDatabase', 'exec', 'execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync', 'prepareAsync', 'sql', 'emitEvent', 'setParams', 'setOptions', 'dismissTo', 'pushState', 'replaceState', 'go', 'sendBeacon', 'register', 'importKey', 'deriveKey', 'encode', 'decode', 'TextEncoder', 'TextDecoder', 'drawText', 'Paragraph', 'makeFromText', 'getTextStyle', 'countBy']);
// fillText desenha texto num canvas: visível, mas são marcas d'água/assinaturas com o nome da app; fica de fora e regista-se.

const RESERVED_VARS = { count: 'total', other: 'others', context: 'ctx', defaultValue: 'def', lng: 'lang', lngs: 'langs', ns: 'nsName', replace: 'rep', ordinal: 'ord', returnObjects: 'objs', joinArrays: 'joined', postProcess: 'post', interpolation: 'interp', keyPrefix: 'kp', fallbackLng: 'fallback' };

// ── heurísticas do texto ─────────────────────────────────────────────────────────────────────────────────────────────
const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
const ACCENT = /[À-ÖØ-öø-ÿ]/;
const CSS_WORDS = new Set(['solid', 'dashed', 'dotted', 'none', 'auto', 'inherit', 'initial', 'unset', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'bold', 'normal', 'italic', 'center', 'absolute', 'relative', 'fixed', 'sticky', 'flex', 'row', 'column', 'wrap', 'nowrap', 'hidden', 'visible', 'pointer', 'transparent', 'contain', 'cover', 'sans-serif', 'serif', 'monospace', 'system-ui', 'inset', 'important', 'infinite', 'alternate', 'forwards', 'both', 'block', 'inline', 'grid', 'scroll', 'mandatory', 'proximity', 'x', 'y', 'start', 'end', 'stretch', 'baseline', 'repeat', 'no-repeat', 'round', 'butt', 'miter', 'opacity', 'transform', 'blur', 'saturate', 'brightness', 'contrast', 'all', 'and', 'max-width', 'min-width', 'screen', 'prefers-color-scheme', 'dark', 'light', 'portrait', 'landscape', 'hover', 'standalone', 'display-mode', 'or', 'not', 'only', 'print']);

/** Partes estáticas de uma frase: código, URL, CSS…? */
function codeLike(s) {
  const t = s.replace(/\{\w+\}/g, ' ');
  if (/:\/\/|^\s*www\.|^mailto:|^tel:|^data:|^blob:|^file:/i.test(t)) return 'url';
  if (/^\s*[\/~#]|^\s*\.\.?\//.test(t) || /^\s*@\//.test(t)) return 'caminho';
  if (/[{}<>=\\`$]/.test(t)) return 'caracteres de código';
  if (/\b\d+(\.\d+)?(px|ms|deg|em|rem|vh|vw|fr|dp)\b/.test(t)) return 'unidade CSS';
  if (/\w\.(json|png|jpe?g|mp4|webm|mov|m4v|csv|txt|pdf|zip|gif|webp|heic|m4a|mp3|wav|aac|ogg|opus|svg|html?|js|ts|tsx|apk|ics|vcf)\b/i.test(t) || /^[\w-]+-\s*\.\w{2,4}$/.test(t.trim())) return 'nome de ficheiro';
  if (/\b(rgba?|hsla?|var|calc|translate[XYZ3d]*|rotate[XYZ]?|scale[XYZ]?|cubic-bezier|steps|linear-gradient|radial-gradient|conic-gradient|url|blur|drop-shadow|matrix)\(/.test(t)) return 'função CSS';
  const words = t.trim().split(/\s+/).filter(Boolean);
  if (words.length && words.every((w) => CSS_WORDS.has(w.replace(/[,()]/g, '').toLowerCase()) || /^[\d.,%+-]+$/.test(w))) return 'palavras CSS';
  if (words.length === 1) {
    const w = words[0];
    if (/^[a-z]+[A-Z]\w*$/.test(w)) return 'identificador camelCase';
    if (/^[\w]+_[\w]+$/.test(w)) return 'identificador snake_case';
    if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(w)) return 'identificador kebab';
    if (/^[\w-]+(\.[\w-]+)+$/.test(w) && !/[.!?…]$/.test(w)) return 'identificador com pontos';
    if (/^\w+\/[\w.+-]+$/.test(w)) return 'tipo MIME/caminho';
    if (/^[A-Z0-9_]{2,}$/.test(w) && /_/.test(w)) return 'constante';
  }
  if (/^[A-Z][a-z]+(-[A-Z][a-z]+)+$/.test(t.trim())) return 'cabeçalho HTTP';
  if (/\b(Bearer|Basic|application\/|text\/|image\/|video\/|audio\/|charset|utf-8|base64)\b/i.test(t)) return 'protocolo';
  if (/\b(YYYY|MM|DD|HH|mm|ss)\b/.test(t) && /[-:\/]/.test(t)) return 'formato de data';
  if (/(^|\s)(M|L|C|Q|A|Z|H|V)\s?-?\d/.test(t) && /\d/.test(t) && (t.match(/\d/g) ?? []).length > 4) return 'caminho SVG';
  if (/\b(function|return|const|let|var|=>|document\.|window\.|addEventListener|innerHTML)\b/.test(t)) return 'código';
  return null;
}
const proseWords = (s) => s.replace(/\{\w+\}/g, ' ').split(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+/).filter((w) => w.replace(/['’-]/g, '').length >= 2 && LETTER.test(w));

/** Decide se o texto (partes estáticas) passa. `strength`: 'strong' (sítio visível certo) ou 'weak' (só se for prosa clara). */
function judge(staticText, strength) {
  const s = staticText.trim();
  if (!LETTER.test(s)) return { ok: false, why: 'sem letras' };
  const words = proseWords(s);
  if (!words.length) return { ok: false, why: 'sem palavras' };
  const bare = s.replace(/[.!?…:,;«»"“”()]/g, '').trim();
  if (GLOSSARY.has(bare.toLowerCase())) return { ok: false, why: 'só um termo do glossário' };
  if (KEEP_AS_IS.has(s) || KEEP_AS_IS.has(bare)) return { ok: false, why: 'marca ou texto que não se traduz' };
  const code = codeLike(s);
  if (code) return { ok: false, why: code };
  if (/[{}]/.test(s.replace(/\{\w+\}/g, ''))) return { ok: false, why: 'chavetas no texto' };
  if (strength === 'strong') return { ok: true };
  // fraco: prosa clara
  if (words.length >= 2) return { ok: true, doubt: words.length === 2 && !/[A-ZÀ-Ú.!?…:]/.test(s) && !ACCENT.test(s) ? 'duas palavras minúsculas' : undefined };
  if (ACCENT.test(s)) return { ok: true };
  if (/^[A-ZÀ-Ú][a-zà-ÿ'’-]+[.!?…:]?$/.test(bare) || /^[A-ZÀ-Ú][a-zà-ÿ]+[.!?…]$/.test(s)) return { ok: true, doubt: 'uma palavra só, fora de um sítio visível' };
  return { ok: false, why: 'palavra solta fora de um sítio visível' };
}
const looksProse = (s) => LETTER.test(s) && proseWords(s).length > 0 && !codeLike(s) && (proseWords(s).length >= 2 || ACCENT.test(s) || /^[A-ZÀ-Ú][a-zà-ÿ]/.test(s.trim()));

// ── programa ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const cfgPath = path.join(APP, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
const norm = (p) => p.replace(/\\/g, '/');
const srcRoot = norm(path.join(APP, 'src')) + '/';
const allFiles = cfg.fileNames.map(norm).filter((f) => f.startsWith(srcRoot));

if (LIST) { listPhrases(allFiles); process.exit(0); }

const t0 = Date.now();
const host = ts.createCompilerHost(cfg.options, true);
const program = ts.createProgram({ rootNames: cfg.fileNames, options: { ...cfg.options, noEmit: true }, host });
const checker = program.getTypeChecker();
console.error(`programa: ${program.getSourceFiles().length} ficheiros em ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const targets = allFiles.filter((f) => !EXCLUDE_FILES.some((re) => re.test(f)) && (!ONLY.length || ONLY.some((o) => f.startsWith(norm(path.join(APP, o)) + '/') || f === norm(path.join(APP, o)))));

// Os textos usados como valor (comparações, case, includes…) em toda a app: se um candidato também é valor, não se toca.
const globalValues = new Set();
const fileValues = new Map();
for (const f of allFiles) {
  const sf = program.getSourceFile(f) ?? program.getSourceFile(f.replace(/\//g, path.sep));
  if (!sf) continue;
  const set = new Set();
  const visit = (n) => {
    if (ts.isStringLiteralLike(n) && isValueUse(n)) { set.add(n.text); globalValues.add(n.text); }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  fileValues.set(f, set);
}

/** Literal usado como valor: comparado, `case`, `includes`, chave computada, tipo literal, índice… */
function isValueUse(n) {
  let p = n.parent;
  let c = n;
  while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) && p.condition !== c || ts.isAsExpression(p))) { c = p; p = p.parent; }
  if (!p) return false;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === c) return true;
  if (ts.isComputedPropertyName(p)) return true;
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ['includes', 'indexOf', 'has', 'startsWith', 'endsWith', 'get', 'delete'].includes(p.expression.name.text)) return true;
  if (ts.isArrayLiteralExpression(p) && ts.isPropertyAccessExpression(p.parent) && p.parent.name.text === 'includes') return true;
  return false;
}

// ── por ficheiro ─────────────────────────────────────────────────────────────────────────────────────────────────────
const LOG = (() => { try { return JSON.parse(fs.readFileSync(LOG_JSON, 'utf8')); } catch { return {}; } })();
let changedFiles = 0;
const results = new Map();
const extEdits = new Map(); // SourceFile → [{node, text}]
for (const f of targets) {
  const sf = program.getSourceFile(f) ?? program.getSourceFile(f.replace(/\//g, path.sep));
  if (!sf) continue;
  const res = transformFile(sf, null);
  results.set(sf, res);
  for (const [file, edits] of res.external) { if (!extEdits.has(file)) extEdits.set(file, []); extEdits.get(file).push(...edits); }
}
// usos de constantes que passaram a função noutros ficheiros: os do lote voltam a fazer-se com esses usos; os outros levam
// só a troca do nome.
for (const [file, edits] of extEdits) {
  const seed = new Map(edits.map((e) => [e.node, e.text]));
  if (results.has(file)) results.set(file, transformFile(file, seed));
  else results.set(file, { changed: true, text: applyEdits(file, edits), done: [], skipped: [], doubts: [{ line: 0, phrase: edits.map((e) => e.text).join(', '), why: 'usos de constantes de outro ficheiro que passaram a função' }], external: new Map(), extra: true });
}
for (const [sf, res] of results) {
  const rel = path.relative(APP, sf.fileName).replace(/\\/g, '/');
  if (res.changed) {
    changedFiles++;
    if (!DRY) fs.writeFileSync(sf.fileName, res.text);
  }
  if (res.extra) { const prev = LOG[rel] ?? { done: [], skipped: [], doubts: [] }; LOG[rel] = { ...prev, doubts: [...prev.doubts, ...res.doubts] }; continue; }
  if (res.done.length || res.skipped.length || res.doubts.length) LOG[rel] = { done: res.done, skipped: res.skipped, doubts: res.doubts, at: new Date().toISOString() };
}
if (!DRY) { fs.mkdirSync(path.dirname(LOG_JSON), { recursive: true }); fs.writeFileSync(LOG_JSON, JSON.stringify(LOG, null, 1)); writeReport(LOG); }
console.error(`${targets.length} ficheiros vistos, ${changedFiles} mudados${DRY ? ' (a seco)' : ''}`);

function transformFile(sf, seed) {
  const text = sf.text;
  const fileSet = fileValues.get(norm(sf.fileName)) ?? new Set();
  const done = [];
  const skipped = [];
  const doubts = [];
  const external = new Map();
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  /** node → texto de substituição (função que recebe emit) */
  const repl = new Map();
  /** JsxElement/Fragment → lista de corridas a substituir nos filhos */
  const jsxRuns = new Map();
  /** PropertyAssignment → passar a getter */
  const getters = new Set();
  /** constantes do módulo que passam a função: nome → declaração */
  const lazyConsts = new Map();
  /** identificadores a trocar: node → texto */
  const identRepl = new Map(seed ?? []);
  const callSites = [];
  const handled = new Set();

  // 1) texto JSX
  const visitJsx = (n) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) collectRuns(n);
    ts.forEachChild(n, visitJsx);
  };
  visitJsx(sf);

  function collectRuns(el) {
    const tag = ts.isJsxElement(el) ? el.openingElement.tagName.getText(sf) : '';
    if (/^(style|script|code|pre)$/.test(tag)) return;
    const kids = el.children;
    let run = [];
    const blank = (k) => ts.isJsxText(k) ? !k.text.trim() : ts.isStringLiteralLike(skipOuter(k.expression)) && !skipOuter(k.expression).text.trim();
    const flush = () => {
      while (run.length && blank(run[0])) run.shift();
      while (run.length && blank(run[run.length - 1])) run.pop();
      if (run.length) { const r = buildRun(run, el); if (r) { if (!jsxRuns.has(el)) jsxRuns.set(el, []); jsxRuns.get(el).push(r); } }
      run = [];
    };
    for (const k of kids) {
      if (ts.isJsxText(k)) run.push(k);
      else if (ts.isJsxExpression(k) && k.expression && inlineable(k.expression)) run.push(k);
      else flush();
    }
    flush();
  }

  /** Expressão que pode entrar numa frase JSX como `{nome}`: texto ou número, sem JSX. */
  function inlineable(e) {
    e = skipOuter(e);
    if (ts.isStringLiteralLike(e)) return true;
    if (ts.isTemplateExpression(e)) return true;
    if (isPluralCond(e)) return true;
    if (containsJsx(e)) return false;
    if (isTCall(e)) return false;
    if (ts.isConditionalExpression(e) || ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return false;
    return isStrOrNum(checker.getTypeAtLocation(e), false);
  }

  function buildRun(nodes, el) {
    // partes: {s: texto} | {e: expressão}
    const parts = [];
    let hasProse = false;
    for (const k of nodes) {
      if (ts.isJsxText(k)) {
        const raw = k.text;
        if (/&[#\w]+;/.test(raw)) return logSkip(k, raw.trim(), 'entidades HTML no texto JSX'), null;
        const s = jsxNormalize(raw);
        if (s) { parts.push({ s }); if (LETTER.test(s)) hasProse = true; }
      } else {
        const e = skipOuter(k.expression);
        if (ts.isStringLiteralLike(e)) { parts.push({ s: e.text, lit: true }); if (LETTER.test(e.text)) hasProse = true; }
        else if (ts.isTemplateExpression(e)) { parts.push({ s: e.head.text }); for (const sp of e.templateSpans) { parts.push({ e: sp.expression }); parts.push({ s: sp.literal.text }); } if (LETTER.test(e.head.text + e.templateSpans.map((x) => x.literal.text).join(''))) hasProse = true; }
        else parts.push({ e });
      }
    }
    if (!hasProse) return null;
    // aparar: o espaço do princípio/fim fica fora da frase (no código como está)
    const first = nodes[0], last = nodes[nodes.length - 1];
    let start = first.getStart(sf), end = last.end;
    if (ts.isJsxText(first)) { const m = /^\s*/.exec(first.text); start = first.pos + m[0].length; }
    if (ts.isJsxText(last)) { const m = /\s*$/.exec(last.text); end = last.end - m[0].length; }
    // só os espaços que o JSX mostra contam; se a frase começar/acabar com espaço visível, fica fora (como texto JSX)
    while (parts.length && parts[0].s !== undefined && !parts[0].s.trim()) parts.shift();
    while (parts.length && parts[parts.length - 1].s !== undefined && !parts[parts.length - 1].s.trim()) parts.pop();
    if (!parts.length) return null;
    let lead = '', trail = '';
    if (parts[0].s !== undefined) { const m = /^\s+/.exec(parts[0].s); if (m) { if (parts[0].lit) return null; lead = m[0]; parts[0] = { ...parts[0], s: parts[0].s.slice(m[0].length) }; } }
    const lp = parts[parts.length - 1];
    if (lp.s !== undefined) { const m = /\s+$/.exec(lp.s); if (m) { if (lp.lit) return null; trail = m[0]; parts[parts.length - 1] = { ...lp, s: lp.s.slice(0, -m[0].length) }; } }
    // um texto JSX aparado à volta tem os espaços no próprio código (start/end), por isso lead/trail só existem quando
    // o espaço veio de dentro de uma linha: nesse caso já está no código fora de [start, end).
    if (lead && !ts.isJsxText(first)) return null;
    if (trail && !ts.isJsxText(last)) return null;
    const phrase = buildPhrase(parts, 'jsx');
    if (!phrase) return null;
    const verdict = judge(phrase.staticText, 'strong');
    if (!verdict.ok) { if (looksProse(phrase.staticText)) logSkip(first, phrase.key, verdict.why); return null; }
    for (const k of nodes) {
      handled.add(k);
      if (ts.isJsxExpression(k)) {
        const e = skipOuter(k.expression);
        if (ts.isStringLiteralLike(e) || ts.isTemplateExpression(e)) handled.add(e);
        const pc = isPluralCond(e);
        if (pc && phrase.plural) { handled.add(skipOuter(e.whenTrue)); handled.add(skipOuter(e.whenFalse)); }
      }
    }
    done.push({ line: lineOf(first), kind: 'jsx', phrase: phrase.key });
    callSites.push(first);
    return { start, end, phrase, nodes };
  }

  // 2) literais (strings, templates, concatenações) noutros sítios
  const visitLits = (n) => {
    if (isTCall(n) || isTrCall(n)) return; // já traduzido
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportTypeNode?.(n) || ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (ts.isJsxText(n)) return;
    if (ts.isConditionalExpression(n) && !handled.has(n)) {
      const pt = pluralTernary(n, checker);
      if (pt) {
        handled.add(n);
        for (const b of pt.branches) handled.add(b);
        considerUnit(n, null, pt);
        ts.forEachChild(n, visitLits);
        return;
      }
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n)) {
      if (!handled.has(n)) considerUnit(n);
      if (ts.isTemplateExpression(n)) ts.forEachChild(n, visitLits);
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && n.parent.left === n)) {
      const ops = flattenPlus(n);
      if (ops.length >= 2 && (isStrLit(ops[0]) || isStrLit(ops[1]))) {
        for (const o of ops) if (isStrLit(o) || ts.isTemplateExpression(skipOuter(o))) handled.add(skipOuter(o));
        considerUnit(n, ops);
        for (const o of ops) if (!isStrLit(o)) ts.isTemplateExpression(skipOuter(o)) ? ts.forEachChild(skipOuter(o), visitLits) : visitLits(o);
        return;
      }
    }
    ts.forEachChild(n, visitLits);
  };
  visitLits(sf);

  function considerUnit(u, plusOps, pt) {
    if (handled.has(u) && !plusOps && !pt) return;
    handled.add(u);
    // dentro de um template de um nível acima: decide o de cima (a não ser que fique como está, e então decide este)
    let ctx = classify(u);
    // os dois ramos de um plural evidente (n === 1 ? 'brinde' : 'brindes') são palavras soltas, mas visíveis se o sítio for
    let up = u.parent; while (up && ts.isParenthesizedExpression(up)) up = up.parent;
    if (!ctx.skip && up && isPluralCond(up)) ctx = { ...ctx, strength: 'strong', where: (ctx.where ?? '') + ' (plural)' };
    if (ctx.skip) {
      const st = staticOf(u, plusOps);
      if (st && looksProse(st)) logSkip(u, st, ctx.skip);
      return;
    }
    let parts;
    if (pt) parts = pt.oneParts;
    else if (plusOps) {
      parts = [];
      for (const o of plusOps) if (isStrLit(o)) parts.push({ s: o.text }); else if (ts.isTemplateExpression(skipOuter(o))) { const e = skipOuter(o); parts.push({ s: e.head.text }); for (const sp of e.templateSpans) { parts.push({ e: sp.expression }); parts.push({ s: sp.literal.text }); } } else parts.push({ e: o });
    } else if (ts.isTemplateExpression(u)) {
      parts = [{ s: u.head.text }];
      for (const sp of u.templateSpans) { parts.push({ e: sp.expression }); parts.push({ s: sp.literal.text }); }
    } else parts = [{ s: u.text }];
    if (ts.isStringLiteral(u) && ts.isJsxAttribute(u.parent) && /&[#\w]+;/.test(u.text)) return logSkip(u, u.text, 'entidades HTML');
    const phrase = buildPhrase(parts, plusOps ? 'plus' : 'tpl', pt ? { subject: pt.subject, otherParts: pt.manyParts } : undefined);
    if (!phrase) return;
    if (phrase.plural) for (const p of parts) { const pc = p.e && isPluralCond(p.e); if (pc) { handled.add(skipOuter(skipOuter(p.e).whenTrue)); handled.add(skipOuter(skipOuter(p.e).whenFalse)); } }
    const verdict = judge(phrase.staticText, ctx.strength);
    if (!verdict.ok) {
      if (looksProse(phrase.staticText) || ctx.strength === 'strong' && LETTER.test(phrase.staticText)) logSkip(u, phrase.key, verdict.why + (ctx.where ? ` (${ctx.where})` : ''));
      return;
    }
    const valueSet = ctx.strength === 'strong' ? fileSet : new Set([...fileSet, ...globalValues]);
    if (!phrase.vars.length && valueSet.has(phrase.key)) return logSkip(u, phrase.key, 'o mesmo texto é usado como valor (comparação, case, includes…)');
    // tipo literal esperado ali (ex.: style: 'cancel' | 'default')
    const ctype = checker.getContextualType(u);
    if (ctype && literalOnly(ctype)) return logSkip(u, phrase.key, 'o tipo ali é uma lista de textos fixos');
    // módulo: avaliado ao carregar
    const lazy = laziness(u);
    if (lazy.kind === 'getter') getters.add(lazy.prop);
    else if (lazy.kind === 'const') lazyConsts.set(lazy.name, lazy);
    const note = lazy.kind === 'eager' ? 'no módulo, avaliado ao carregar' : undefined;
    if (note) doubts.push({ line: lineOf(u), phrase: phrase.key, why: note + (lazy.why ? `: ${lazy.why}` : '') });
    if (verdict.doubt) doubts.push({ line: lineOf(u), phrase: phrase.key, why: verdict.doubt + (ctx.where ? ` (${ctx.where})` : '') });
    done.push({ line: lineOf(u), kind: ctx.where ?? 'literal', phrase: phrase.key, ...(lazy.kind !== 'lazy' ? { lazy: lazy.kind } : {}) });
    const jsxAttr = ts.isJsxAttribute(u.parent) && u.parent.initializer === u;
    repl.set(u, (emit) => { const call = phrase.render(emit); return jsxAttr ? `{${call.expr}}` : call.wrapped(u); });
    callSites.push(u);
  }

  /** O sítio para onde vai o texto: forte, fraco ou não se toca. */
  function classify(u) {
    let c = u;
    let p = u.parent;
    let viaArray = false;
    for (;;) {
      if (!p) return { skip: 'sem contexto' };
      if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression?.(p)) { c = p; p = p.parent; continue; }
      if (ts.isConditionalExpression(p)) { if (p.condition === c) return { skip: 'condição' }; c = p; p = p.parent; continue; }
      if (ts.isBinaryExpression(p)) {
        const k = p.operatorToken.kind;
        if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken) { c = p; p = p.parent; continue; }
        if (k === ts.SyntaxKind.AmpersandAmpersandToken && p.right === c) { c = p; p = p.parent; continue; }
        if (k === ts.SyntaxKind.PlusToken) { c = p; p = p.parent; continue; }
        if (k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.PlusEqualsToken || k === ts.SyntaxKind.QuestionQuestionEqualsToken || k === ts.SyntaxKind.BarBarEqualsToken) {
          if (p.left === c) return { skip: 'destino de atribuição' };
          const nm = lastName(p.left);
          if (/^(textContent|innerText|title|placeholder|ariaLabel|alt|label|value)$/.test(nm ?? '')) return { strength: 'strong', where: `= ${nm}` };
          if (/^(innerHTML|outerHTML|cssText|className|src|href|id|d)$/.test(nm ?? '')) return { skip: `atribuição a ${nm}` };
          return byName(nm, 'atribuição', viaArray);
        }
        return { skip: 'operação ' + ts.tokenToString(k) };
      }
      if (ts.isTemplateSpan(p)) { c = p.parent; p = c.parent; continue; }
      if (ts.isArrayLiteralExpression(p)) { viaArray = true; c = p; p = p.parent; continue; }
      if (ts.isSpreadElement(p)) { c = p; p = p.parent; continue; }
      if (ts.isJsxExpression(p)) {
        const q = p.parent;
        if (ts.isJsxAttribute(q)) return attrCtx(q);
        if (ts.isJsxElement(q) || ts.isJsxFragment(q)) return { strength: 'strong', where: 'filho JSX' };
        if (ts.isJsxSpreadAttribute(q)) return { skip: 'spread JSX' };
        return { skip: 'JSX' };
      }
      if (ts.isJsxAttribute(p)) return attrCtx(p);
      if (ts.isPropertyAssignment(p)) {
        if (p.name === c) return { skip: 'nome de propriedade' };
        return propCtx(p, viaArray);
      }
      if (ts.isShorthandPropertyAssignment(p)) return { skip: 'propriedade' };
      if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
        if (p.expression === c) return { skip: 'chamada' };
        return callCtx(p, c);
      }
      if (ts.isTaggedTemplateExpression(p)) return { skip: 'template com etiqueta' };
      if (ts.isReturnStatement(p) || ts.isArrowFunction(p) && p.body === c) {
        const fn = ts.isArrowFunction(p) ? p : enclosingFn(p);
        return byName(fnName(fn), 'return', viaArray);
      }
      if (ts.isVariableDeclaration(p)) { if (p.name === c) return { skip: 'nome' }; return byName(ts.isIdentifier(p.name) ? p.name.text : null, 'variável', viaArray); }
      if (ts.isBindingElement(p) || ts.isParameter(p)) { return byName(ts.isIdentifier(p.name) ? p.name.text : null, 'valor por omissão', viaArray); }
      if (ts.isPropertyDeclaration(p)) return byName(p.name.getText(sf), 'propriedade de classe', viaArray);
      if (ts.isExportAssignment(p)) return { skip: 'export default' };
      if (ts.isElementAccessExpression(p)) return { skip: 'índice' };
      if (ts.isPropertyAccessExpression(p)) {
        // 'texto'.toUpperCase() e afins: decide o de cima, com a mesma força
        if (ts.isCallExpression(p.parent) && /^(toUpperCase|toLowerCase|trim)$/.test(p.name.text)) { c = p.parent; p = c.parent; continue; }
        // ['Frase a', 'Frase b'].map(…) / .join(…): uma lista de textos para mostrar
        if (viaArray && ts.isCallExpression(p.parent) && /^(map|join|forEach|flatMap)$/.test(p.name.text)) return { strength: 'weak', where: `lista .${p.name.text}()` };
        return { skip: 'acesso a propriedade' };
      }
      if (ts.isCaseClause(p) || ts.isSwitchStatement(p)) return { skip: 'case' };
      if (ts.isExpressionStatement(p)) return { skip: 'expressão solta' };
      if (ts.isEnumMember(p)) return { skip: 'enum' };
      if (ts.isTypeOfExpression(p) || ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isPrefixUnaryExpression(p)) return { skip: 'condição' };
      if (ts.isPropertyAccessChain?.(p)) return { skip: 'acesso' };
      return { skip: 'contexto ' + ts.SyntaxKind[p.kind] };
    }
  }
  function attrCtx(a) {
    const nm = a.name.getText(sf);
    if (nm === 'value') {
      const tag = a.parent.parent.tagName?.getText(sf) ?? '';
      if (/(TextInput|Input|input|textarea|Slider|Switch|Picker|select|option|Field|Search\w*|Checkbox|Radio|Toggle|Segmented\w*|Tabs?|Chip|Choice|Option)$/.test(tag)) return { skip: `value de ${tag}` };
      return { strength: 'strong', where: 'value=' };
    }
    if (VIS_ATTR.has(nm) || VIS_SUFFIX.test(nm)) return { strength: 'strong', where: `${nm}=` };
    if (NONVIS_ATTR.has(nm) || /^(on[A-Z]|data-|aria-(controls|labelledby|describedby|owns|current|expanded|selected|checked|pressed|haspopup))/.test(nm)) return { skip: `atributo ${nm}` };
    return { strength: 'weak', where: `${nm}=` };
  }
  function propCtx(p, viaArray) {
    const nm = p.name.getText(sf).replace(/^['"]|['"]$/g, '');
    if (nm === 'name') {
      // `name` costuma ser chave ou nome próprio; só passa se o objeto tiver outros textos visíveis ao lado
      const sibs = p.parent.properties.filter((x) => x !== p && x.name).map((x) => x.name.getText(sf));
      if (sibs.some((s) => ['mood', 'description', 'desc', 'hint', 'label', 'sub', 'subtitle', 'tip', 'why'].includes(s))) return { strength: 'weak', where: 'name: (com textos ao lado)' };
      return { skip: 'propriedade name (chave ou nome próprio)' };
    }
    if (VIS_PROP.has(nm)) return { strength: 'strong', where: `${nm}:` };
    if (NONVIS_PROP.has(nm) || CSS_PROP.test(nm) && !VIS_SUFFIX.test(nm)) return { skip: `propriedade ${nm}` };
    if (VIS_SUFFIX.test(nm)) return { strength: 'strong', where: `${nm}:` };
    // Record de rótulos: const LABEL: Record<K, string> = { fotos: 'Fotos' }  → o nome da variável decide
    const holder = objectHolderName(p.parent);
    if (holder) { const r = byName(holder, 'objeto', viaArray); if (r.skip) return r; return { ...r, where: `${holder}.${nm}` }; }
    return { strength: 'weak', where: `${nm}:` };
  }
  function callCtx(call, arg) {
    const callee = call.expression;
    const nm = lastName(callee);
    const full = callee.getText(sf);
    if (/^console\./.test(full) || /^(Haptics|Linking|Sentry|StyleSheet|Platform\.OS|AsyncStorage|SecureStore|Notifications|FileSystem|MediaLibrary|ImagePicker|Clipboard|Sharing|Font|Asset|router|navigation|queryClient|qc|document|window|location|history|navigator|localStorage|sessionStorage|JSON|Object|Reflect|Math|Intl|crypto|performance)\b/.test(full) && nm !== 'alert' && nm !== 'confirm' && nm !== 'prompt') return { skip: `argumento de ${full}` };
    if (nm === 'Error' || nm === 'ApiError' || nm === 'TypeError' || nm === 'RangeError') return { strength: 'weak', where: `new ${nm}` };
    if (nm && VIS_CALLS.has(nm)) return { strength: 'strong', where: `${nm}()` };
    if (nm && NONVIS_CALLS.has(nm)) return { skip: `argumento de ${nm}()` };
    if (nm && /^(set[A-Z]\w*)$/.test(nm)) {
      const w = splitWords(nm.slice(3));
      if (w.some((x) => VIS_WORDS.has(x)) && !NONVIS_WORDS.has(w[w.length - 1])) return { strength: 'strong', where: `${nm}()` };
      return { strength: 'weak', where: `${nm}()` };
    }
    if (nm && /^use[A-Z]/.test(nm)) return { strength: 'weak', where: `${nm}()` };
    return { strength: 'weak', where: nm ? `${nm}()` : 'chamada' };
  }
  function byName(nm, kind, viaArray) {
    if (!nm) return { strength: 'weak', where: kind };
    const w = splitWords(nm);
    const lastW = w[w.length - 1];
    if (NONVIS_WORDS.has(lastW) || w.some((x) => ['css', 'svg', 'html', 'url', 'uri', 'regex', 'mime', 'sql', 'js', 'style', 'font', 'path', 'icon', 'emoji', 'key', 'storage', 'route', 'href', 'shadow', 'gradient'].includes(x))) return { skip: `${kind} ${nm}` };
    // o nome só ajuda a decidir o que fica de fora: a frase tem de ser prosa clara na mesma
    return { strength: 'weak', where: `${kind} ${nm}` };
  }
  function objectHolderName(obj) {
    let c = obj, p = obj.parent;
    while (p && (ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p) || ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isCallExpression(p) && /^(freeze)$/.test(lastName(p.expression) ?? ''))) { c = p; p = p.parent; }
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (p && ts.isPropertyAssignment(p)) return p.name.getText(sf);
    return null;
  }

  /** Avaliado só quando se mostra (lazy), ou no módulo: getter, constante-função, ou fica (eager). */
  function laziness(u) {
    let prop = null;
    let c = u;
    for (let p = u.parent; p; c = p, p = p.parent) {
      if (ts.isFunctionLike(p) && !ts.isConstructorTypeNode?.(p) || ts.isClassStaticBlockDeclaration?.(p)) return { kind: 'lazy' };
      if (ts.isPropertyDeclaration(p) && !p.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) return { kind: 'lazy' };
      if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) { /* JSX no módulo é raro */ }
      if (!prop && ts.isPropertyAssignment(p) && p.initializer === c && ts.isObjectLiteralExpression(p.parent)) prop = p;
      if (ts.isSourceFile(p)) break;
    }
    if (prop) return { kind: 'getter', prop };
    // constante do módulo só usada dentro de funções → passa a função
    let decl = null;
    for (let p = u.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) && ts.isVariableStatement(p.parent?.parent) && ts.isSourceFile(p.parent.parent.parent)) { decl = p; break; }
    if (decl && ts.isIdentifier(decl.name) && decl.initializer && (decl.parent.flags & ts.NodeFlags.Const)) {
      const chk = constCanBeFunction(decl);
      if (chk.ok) return { kind: 'const', name: decl.name.text, decl, refs: chk.refs };
      return { kind: 'eager', why: chk.why };
    }
    return { kind: 'eager' };
  }
  function constCanBeFunction(decl) {
    const sym = checker.getSymbolAtLocation(decl.name);
    if (!sym) return { ok: false, why: 'sem símbolo' };
    const exported = decl.parent.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const refs = [];
    const files = exported ? program.getSourceFiles().filter((s) => norm(s.fileName).startsWith(srcRoot)) : [sf];
    let why = null;
    for (const s of files) {
      if (norm(s.fileName).includes('/node_modules/')) continue;
      if (exported && s !== sf && !s.text.includes(decl.name.text)) continue;
      const visit = (n) => {
        if (why) return;
        if (ts.isIdentifier(n) && n.text === decl.name.text && n !== decl.name) {
          let target = checker.getSymbolAtLocation(n);
          if (target && target.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
          if (ts.isShorthandPropertyAssignment(n.parent)) target = checker.getShorthandAssignmentValueSymbol(n.parent);
          if (target === sym) {
            const p = n.parent;
            if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) return;
            if (ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p)) { why = 'usada num tipo (typeof)'; return; }
            if (!insideFunction(n)) { why = 'usada no próprio módulo fora de funções'; return; }
            if (ts.isBinaryExpression(p) && p.left === n) { why = 'reatribuída'; return; }
            refs.push({ file: s, node: n, shorthand: ts.isShorthandPropertyAssignment(p) });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(s);
      if (why) break;
    }
    if (why) return { ok: false, why };
    return { ok: true, refs };
  }

  // 3) os `t` locais que tapariam o t() importado
  // (feito no fim, quando já se sabe onde ficam as chamadas)

  // ── montar ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const anyCall = callSites.length > 0;
  if (!anyCall && !seed) return { changed: false, text, done, skipped, doubts, external };

  // constantes-função: declaração `const X = init` → `const X = () => init` e as referências → X()
  for (const lz of lazyConsts.values()) {
    const init = lz.decl.initializer;
    const r0 = repl.get(init);
    repl.set(init, (emit) => { const body = r0 ? r0(emit) : emitChildren(init, init.getStart(sf), init.end); return `() => ${needsParensForArrowBody(init) ? `(${body})` : body}`; });
    if (lz.decl.type) repl.set(lz.decl.type, () => `() => ${lz.decl.type.getText(sf)}`);
    for (const r of lz.refs) {
      const txt = r.shorthand ? `${r.node.text}: ${r.node.text}()` : `${r.node.text}()`;
      if (r.file === sf) identRepl.set(r.node, txt);
      else { if (!external.has(r.file)) external.set(r.file, []); external.get(r.file).push({ node: r.node, start: r.node.getStart(r.file), end: r.node.end, text: txt }); }
    }
    doubts.push({ line: lineOf(lz.decl), phrase: lz.name, why: `constante do módulo passou a função (${lz.refs.length} usos${lz.refs.some((r) => r.file !== sf) ? ', também noutros ficheiros' : ''})` });
  }

  // os `t` locais que tapariam o t() importado
  const renamed = anyCall ? renameLocalT(callSites.map((u) => (ts.isJsxText(u) ? u.pos : u.getStart(sf)))) : [];
  if (renamed === null) { skipped.push({ line: 0, text: '(ficheiro)', why: 'importa um `t` de outro módulo' }); return { changed: false, text, done: [], skipped, doubts, external: new Map() }; }

  // o import entra a seguir ao último import (ou antes da primeira instrução)
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const IMPORT = `import { t } from '@/lib/i18n';`;
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
  const i18nImport = imports.find((s) => /^['"]@\/lib\/i18n['"]$/.test(s.moduleSpecifier.getText(sf)));
  let importHook = null;
  if (anyCall) {
    if (i18nImport) {
      const nb = i18nImport.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb) && !nb.elements.some((e) => e.name.text === 't')) repl.set(i18nImport, () => `import { ${[...nb.elements.map((e) => e.getText(sf)), 't'].join(', ')} } from '@/lib/i18n';`);
      else if (!nb) importHook = { after: i18nImport };
    } else if (imports.length) importHook = { after: imports[imports.length - 1] };
    else importHook = { before: sf.statements.find((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression))) ?? null };
  }

  const emit = (node) => emitNode(node);
  function emitNode(node) {
    let s;
    if (identRepl.has(node)) s = identRepl.get(node);
    else if (repl.get(node)) s = repl.get(node)(emit);
    else if (getters.has(node)) s = `get ${node.name.getText(sf)}() { return ${emit(node.initializer)}; }`;
    else if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && jsxRuns.has(node)) s = emitJsx(node);
    else s = emitChildren(node, ts.isJsxText(node) ? node.pos : node.getStart(sf), node.end);
    if (importHook?.after === node) s += eol + IMPORT;
    if (importHook?.before === node) s = IMPORT + eol + s;
    return s;
  }
  function emitChildren(node, from, to) {
    let out = '';
    let cur = from;
    const kids = [];
    ts.forEachChild(node, (k) => { kids.push(k); });
    for (const k of kids) {
      const s = ts.isJsxText(k) ? k.pos : k.getStart(sf);
      if (s < cur) return text.slice(from, to); // ordem estranha: fica como está
      out += text.slice(cur, s) + emitNode(k);
      cur = k.end;
    }
    return out + text.slice(cur, to);
  }
  function emitJsx(el) {
    const runOf = new Map();
    for (const r of jsxRuns.get(el)) for (const n of r.nodes) runOf.set(n, r);
    let out = '';
    let cur = el.getStart(sf);
    const kids = [];
    ts.forEachChild(el, (k) => { kids.push(k); });
    for (const k of kids) {
      const r = runOf.get(k);
      const s = ts.isJsxText(k) ? k.pos : k.getStart(sf);
      if (r) {
        if (k === r.nodes[0]) { out += text.slice(cur, r.start) + `{${r.phrase.render(emit).expr}}`; cur = r.end; }
        if (k === r.nodes[r.nodes.length - 1]) { out += text.slice(cur, k.end); cur = k.end; }
        continue;
      }
      out += text.slice(cur, s) + emitNode(k);
      cur = k.end;
    }
    return out + text.slice(cur, el.end);
  }

  let out = emitChildren(sf, 0, text.length);
  if (importHook && importHook.before === null) out = IMPORT + eol + out;
  if (out === text) return { changed: false, text, done, skipped, doubts, external };
  if (renamed.length) doubts.push({ line: 0, phrase: renamed.join(', '), why: 'variáveis locais `t` renomeadas para não taparem o t()' });
  return { changed: true, text: out, done, skipped, doubts, external };

  // ── ajudas que precisam do ficheiro ────────────────────────────────────────────────────────────────────────────────
  function logSkip(n, s, why) { skipped.push({ line: lineOf(n), text: String(s).slice(0, 140), why }); }

  function renameLocalT(positions) {
    const done = [];
    const decls = [];
    const visit = (n) => {
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === 't') decls.push(n);
      if (ts.isImportSpecifier(n) && n.name.text === 't' && !/i18n/.test(n.parent.parent.parent.moduleSpecifier.getText(sf))) importsT = true;
      ts.forEachChild(n, visit);
    };
    let importsT = false;
    visit(sf);
    if (importsT) return null;
    if (!decls.length) return done;
    const names = new Set();
    const collect = (n) => { if (ts.isIdentifier(n)) names.add(n.text); ts.forEachChild(n, collect); };
    collect(sf);
    for (const d of decls) {
      const scope = scopeOf(d);
      if (!positions.some((p) => p >= scope.getStart(sf) && p < scope.end)) continue;
      const sym = checker.getSymbolAtLocation(d.name);
      if (!sym) continue;
      const nn = pickName(d, names);
      names.add(nn);
      done.push(`t→${nn} (linha ${lineOf(d)})`);
      const visitId = (n) => {
        if (ts.isIdentifier(n) && n.text === 't') {
          const p = n.parent;
          if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
            if (checker.getShorthandAssignmentValueSymbol(p) === sym) identRepl.set(n, `t: ${nn}`);
          } else if (ts.isBindingElement(p) && p.name === n && !p.propertyName && p === d) {
            identRepl.set(n, ts.isObjectBindingPattern(p.parent) ? `t: ${nn}` : nn);
          } else if ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isQualifiedName(p) && p.right === n) {
            /* nome de propriedade */
          } else if (checker.getSymbolAtLocation(n) === sym) identRepl.set(n, nn);
        }
        ts.forEachChild(n, visitId);
      };
      visitId(sf);
    }
    return done;
  }
  function scopeOf(d) {
    if (ts.isParameter(d)) return d.parent;
    let p = d.parent;
    if (ts.isBindingElement(d)) { while (p && !ts.isVariableDeclaration(p) && !ts.isParameter(p)) p = p.parent; if (p && ts.isParameter(p)) return p.parent; }
    const isVar = p && ts.isVariableDeclaration(p) ? !(p.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) : ts.isVariableDeclaration(d) && !(d.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
    for (let q = d.parent; q; q = q.parent) {
      if (ts.isFunctionLike(q) && q !== d) return q;
      if (!isVar && (ts.isBlock(q) || ts.isForStatement(q) || ts.isForOfStatement(q) || ts.isForInStatement(q) || ts.isCaseBlock(q))) return q;
      if (ts.isSourceFile(q)) return q;
    }
    return sf;
  }
  function pickName(d, names) {
    let base = 'tv';
    const init = ts.isVariableDeclaration(d) ? d.initializer?.getText(sf) ?? '' : '';
    let tyText = '';
    try { tyText = checker.typeToString(checker.getTypeAtLocation(d.name)); } catch { /* */ }
    if (/setTimeout|setInterval|requestAnimationFrame/.test(init) || /Timeout|Timer|Interval/.test(tyText)) base = 'timer';
    else if (/touches|Touch/.test(init + tyText)) base = 'touch';
    else if (/Track/.test(tyText) || /[Tt]racks?\(/.test(init)) base = 'track';
    else if (/^string$/.test(tyText)) base = 'txt';
    else if (/^number$/.test(tyText)) base = 'tv';
    else if (/^[A-Z][A-Za-z]+$/.test(tyText) && tyText.length < 16) base = tyText[0].toLowerCase() + tyText.slice(1);
    let nn = base;
    for (let i = 2; names.has(nn) || nn === 't'; i++) nn = base + i;
    return nn;
  }

  function staticOf(u, plusOps) {
    if (plusOps) return plusOps.filter(isStrLit).map((o) => o.text).join(' ');
    if (ts.isTemplateExpression(u)) return [u.head.text, ...u.templateSpans.map((s) => s.literal.text)].join(' ');
    return u.text;
  }

  /** Frase a partir das partes: chave com `{nome}`, variáveis e o plural evidente. */
  function buildPhrase(parts, where, forced) {
    // juntar textos seguidos
    const join = (list) => { const ps = []; for (const p of list) { if (p.s !== undefined && ps.length && ps[ps.length - 1].s !== undefined) ps[ps.length - 1] = { s: ps[ps.length - 1].s + p.s }; else ps.push(p); } return ps; };
    const ps = join(parts);
    const exprText = (e) => skipOuter(e).getText(sf).replace(/\s+/g, ' ');
    // plural: um `E === 1 ? 'a' : 'b'` com E também na frase (ou o ternário inteiro, `forced`)
    let plural = null;
    const exprs = ps.filter((p) => p.e).map((p) => p.e);
    if (forced) plural = { subject: forced.subject, subj: exprText(forced.subject) };
    else for (const e of exprs) {
      const pc = isPluralCond(e);
      if (!pc) continue;
      const subj = exprText(pc.subject);
      if (exprs.some((x) => x !== e && exprText(x) === subj) && isNum(checker.getTypeAtLocation(pc.subject))) { plural = { cond: e, ...pc, subj }; break; }
    }
    const placeholders = new Set();
    for (const p of ps) if (p.s) for (const m of p.s.matchAll(/\{(\w+)\}/g)) placeholders.add(m[1]);
    const vars = []; // {name, expr, wrap}
    const byText = new Map();
    const used = new Set(placeholders);
    const nameOf = (e) => {
      const key = exprText(e);
      if (byText.has(key)) return byText.get(key).name;
      let base = varName(e);
      if (RESERVED_VARS[base]) base = RESERVED_VARS[base];
      let nm = base;
      for (let i = 2; used.has(nm); i++) nm = base + i;
      used.add(nm);
      const ty = checker.getTypeAtLocation(e);
      const v = { name: nm, expr: e, wrap: where === 'jsx' ? false : !isStrOrNum(ty, true) };
      byText.set(key, v);
      vars.push(v);
      return nm;
    };
    const assemble = (list, which) => {
      let k = '';
      for (const p of list) {
        if (p.s !== undefined) k += p.s;
        else if (p.cnt) k += '{count}';
        else if (plural && plural.cond && p.e === plural.cond) k += which === 'one' ? plural.one : plural.many;
        else if (plural && exprText(p.e) === plural.subj) k += '{count}';
        else k += `{${nameOf(p.e)}}`;
      }
      return k;
    };
    const key = assemble(ps, 'one');
    const other = forced ? assemble(join(forced.otherParts), 'many') : assemble(ps, 'many');
    let staticText = '';
    for (const p of forced ? join(forced.otherParts) : ps) staticText += p.s !== undefined ? p.s : plural?.cond && p.e === plural.cond ? plural.one + ' ' : ' ';
    if (/[{}]/.test(key.replace(/\{\w+\}/g, '')) || /[{}]/.test(other.replace(/\{\w+\}/g, ''))) { return { key, vars, staticText: key, render: null, bad: true }; }
    const lit = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
    // espaços no princípio/fim de uma frase não-JSX ficam fora do t()
    const lead = where === 'jsx' ? '' : /^\s*/.exec(key)[0];
    const trail = where === 'jsx' ? '' : /\s*$/.exec(key.slice(lead.length))[0];
    const coreKey = key.slice(lead.length, key.length - trail.length);
    const coreOther = other.replace(/^\s+/, '').replace(/\s+$/, '');
    if (plural && other.startsWith(lead) === false) return null;
    if (plural && (other !== lead + coreOther + trail)) return null;
    return {
      key: coreKey, vars, staticText, plural: !!plural,
      render(emit) {
        const items = [];
        if (plural) items.push(`count: ${emit(plural.subject)}`);
        for (const v of vars) {
          let val = emit(v.expr);
          if (v.wrap) val = `String(${val})`;
          items.push(val === v.name ? v.name : `${v.name}: ${val}`);
        }
        if (plural && coreOther !== coreKey) items.push(`other: ${lit(coreOther)}`);
        const expr = `t(${lit(coreKey)}${items.length ? `, { ${items.join(', ')} }` : ''})`;
        return {
          expr,
          wrapped(u) {
            if (!lead && !trail) return expr;
            const s = `${lead ? `${lit(lead)} + ` : ''}${expr}${trail ? ` + ${lit(trail)}` : ''}`;
            return `(${s})`;
          },
        };
      },
    };
  }
}

function applyEdits(file, edits) {
  let src = file.text;
  for (const e of edits.slice().sort((a, b) => b.start - a.start)) src = src.slice(0, e.start) + e.text + src.slice(e.end);
  return src;
}

// ── ajudas gerais ─────────────────────────────────────────────────────────────────────────────────────────────────────
function skipOuter(e) { while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression; return e; }
function skipUpOuter(e) { return e; }
function isStrLit(e) { return e && ts.isStringLiteralLike(skipOuter(e)); }
function isTCall(n) { return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't' || ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 't' && /i18n/.test(n.expression.expression.getText()); }
function isTrCall(n) { return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tr'; }
function containsJsx(e) { let f = false; const v = (n) => { if (f) return; if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { f = true; return; } ts.forEachChild(n, v); }; v(e); return f; }
function flattenPlus(n) { const out = []; const go = (e) => { if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { go(e.left); out.push(e.right); } else out.push(e); }; go(n); return out; }
function lastName(e) { e = skipOuter(e); if (!e) return null; if (ts.isIdentifier(e)) return e.text; if (ts.isPropertyAccessExpression(e)) return e.name.text; if (ts.isElementAccessExpression(e)) return lastName(e.expression); if (ts.isCallExpression(e)) return lastName(e.expression); return null; }
function splitWords(nm) { return nm.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$-]+/g, ' ').toLowerCase().trim().split(/\s+/).filter(Boolean); }
function enclosingFn(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return null; }
function insideFunction(n) { for (let p = n.parent; p; p = p.parent) { if (ts.isFunctionLike(p)) return true; if (ts.isPropertyDeclaration(p) && !p.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) return true; } return false; }
function fnName(fn) {
  if (!fn) return null;
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if ((ts.isMethodDeclaration(fn) || ts.isGetAccessor(fn)) && fn.name) return fn.name.getText().replace(/['"]/g, '');
  let p = fn.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isCallExpression(p) && /^(useCallback|useMemo|memo|forwardRef)$/.test(lastName(p.expression) ?? ''))) p = p.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText().replace(/['"]/g, '');
  if (p && ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return p.parent.name.getText();
  return null;
}
function needsParensForArrowBody(e) { e = skipOuter(e); return ts.isObjectLiteralExpression(e); }

/** `n === 1 ? '1 resultado' : `${n} resultados`` (ramos com o número): o ternário inteiro vira um t() com count/other. */
function pluralTernary(e, checker) {
  e = skipOuter(e);
  if (!e || !ts.isConditionalExpression(e)) return null;
  const a = skipOuter(e.whenTrue), b = skipOuter(e.whenFalse);
  const okBranch = (x) => ts.isStringLiteralLike(x) || ts.isTemplateExpression(x);
  if (!okBranch(a) || !okBranch(b)) return null;
  if (ts.isStringLiteralLike(a) && ts.isStringLiteralLike(b)) return null; // os dois literais: isPluralCond
  const pc = pluralCondition(skipOuter(e.condition));
  if (!pc) return null;
  if (!isNum(checker.getTypeAtLocation(pc.subject))) return null;
  const subj = skipOuter(pc.subject).getText().replace(/\s+/g, ' ');
  const partsOf = (x, isOne) => {
    if (ts.isStringLiteralLike(x)) {
      const m = isOne ? /(^|[^\d.,])1(?![\d.,]*\d)/.exec(x.text) : null;
      if (!m) return [{ s: x.text }];
      const at = m.index + m[1].length;
      return [{ s: x.text.slice(0, at) }, { cnt: true }, { s: x.text.slice(at + 1) }];
    }
    const out = [{ s: x.head.text }];
    for (const sp of x.templateSpans) { out.push(skipOuter(sp.expression).getText().replace(/\s+/g, ' ') === subj ? { cnt: true } : { e: sp.expression }); out.push({ s: sp.literal.text }); }
    return out;
  };
  const one = partsOf(pc.oneFirst ? a : b, true), many = partsOf(pc.oneFirst ? b : a, false);
  if (!many.some((p) => p.cnt)) return null;
  // as outras variáveis têm de ser as mesmas nos dois ramos
  const others = (ps) => ps.filter((p) => p.e).map((p) => skipOuter(p.e).getText().replace(/\s+/g, ' ')).sort().join('|');
  if (others(one) !== others(many)) return null;
  return { subject: pc.subject, oneParts: one, manyParts: many, branches: [a, b] };
}
function pluralCondition(c) {
  if (!ts.isBinaryExpression(c)) return null;
  const k = c.operatorToken.kind;
  const isOne = (x) => ts.isNumericLiteral(skipOuter(x)) && skipOuter(x).text === '1';
  const isTwo = (x) => ts.isNumericLiteral(skipOuter(x)) && skipOuter(x).text === '2';
  if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(k)) { if (isOne(c.right)) return { subject: c.left, oneFirst: true }; if (isOne(c.left)) return { subject: c.right, oneFirst: true }; }
  if ([ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(k)) { if (isOne(c.right)) return { subject: c.left, oneFirst: false }; if (isOne(c.left)) return { subject: c.right, oneFirst: false }; }
  if (k === ts.SyntaxKind.GreaterThanToken && isOne(c.right) || k === ts.SyntaxKind.GreaterThanEqualsToken && isTwo(c.right)) return { subject: c.left, oneFirst: false };
  if (k === ts.SyntaxKind.LessThanEqualsToken && isOne(c.right) || k === ts.SyntaxKind.LessThanToken && isTwo(c.right)) return { subject: c.left, oneFirst: true };
  return null;
}

function isPluralCond(e) {
  e = skipOuter(e);
  if (!e || !ts.isConditionalExpression(e)) return null;
  const a = skipOuter(e.whenTrue), b = skipOuter(e.whenFalse);
  if (!ts.isStringLiteralLike(a) || !ts.isStringLiteralLike(b)) return null;
  const c = skipOuter(e.condition);
  if (!ts.isBinaryExpression(c)) return null;
  const k = c.operatorToken.kind;
  const isOne = (x) => ts.isNumericLiteral(skipOuter(x)) && skipOuter(x).text === '1';
  const isTwo = (x) => ts.isNumericLiteral(skipOuter(x)) && skipOuter(x).text === '2';
  let subject = null, oneFirst = null;
  if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(k)) { if (isOne(c.right)) subject = c.left; else if (isOne(c.left)) subject = c.right; oneFirst = true; }
  else if ([ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(k)) { if (isOne(c.right)) subject = c.left; else if (isOne(c.left)) subject = c.right; oneFirst = false; }
  else if (k === ts.SyntaxKind.GreaterThanToken && isOne(c.right) || k === ts.SyntaxKind.GreaterThanEqualsToken && isTwo(c.right)) { subject = c.left; oneFirst = false; }
  else if (k === ts.SyntaxKind.LessThanEqualsToken && isOne(c.right) || k === ts.SyntaxKind.LessThanToken && isTwo(c.right)) { subject = c.left; oneFirst = true; }
  if (!subject) return null;
  const one = oneFirst ? a.text : b.text, many = oneFirst ? b.text : a.text;
  if (!LETTER.test(one + many)) return null;
  return { subject, one, many };
}
function isStrOrNum(ty, allowAny) {
  if (ty.flags & ts.TypeFlags.Any) return allowAny;
  if (ty.isUnion()) return ty.types.every((x) => isStrOrNum(x, false));
  return !!(ty.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike));
}
function isNum(ty) { if (ty.isUnion()) return ty.types.every(isNum); return !!(ty.flags & ts.TypeFlags.NumberLike); }
function literalOnly(ty) {
  const ts_ = ty.isUnion() ? ty.types : [ty];
  const str = ts_.filter((x) => x.flags & ts.TypeFlags.StringLike);
  if (!str.length) return false;
  return str.every((x) => x.flags & ts.TypeFlags.StringLiteral) && !ts_.some((x) => x.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TemplateLiteral));
}
function jsxNormalize(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  const out = [];
  lines.forEach((l, i) => {
    let s = l;
    if (i > 0) s = s.replace(/^[ \t]+/, '');
    if (i < lines.length - 1) s = s.replace(/[ \t]+$/, '');
    if (s) out.push(s);
  });
  return out.join(' ');
}
function DEACCENT(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function varName(e) {
  e = skipOuter(e);
  const clean = (s) => { s = DEACCENT(String(s)).replace(/^[_$]+/, '').replace(/[^\w]/g, ''); if (!s) return 'value'; if (/^\d/.test(s)) s = 'v' + s; return s; };
  if (ts.isIdentifier(e)) return clean(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    const nm = e.name.text;
    if (nm === 'length' || nm === 'size') return 'n';
    if (nm === 'current' || nm === 'value' || nm === 'data') return varName(e.expression);
    return clean(nm);
  }
  if (ts.isElementAccessExpression(e)) { const b = varName(e.expression); return b.length > 3 && b.endsWith('s') ? b.slice(0, -1) : b; }
  if (ts.isCallExpression(e)) {
    const callee = skipOuter(e.expression);
    const nm = lastName(callee) ?? '';
    if (ts.isPropertyAccessExpression(callee) && /^(trim|toString|toLowerCase|toUpperCase|toFixed|toLocaleString|toLocaleDateString|toLocaleTimeString|padStart|padEnd|slice|substring|join|replace|replaceAll|toPrecision|normalize|at)$/.test(nm)) return varName(callee.expression);
    if (/^(String|Number|Math|floor|ceil|round|abs|min|max|trunc|parseInt|parseFloat)$/.test(nm) || ts.isPropertyAccessExpression(callee) && /^Math$/.test(callee.expression.getText())) return e.arguments[0] ? varName(e.arguments[0]) : 'n';
    const m = /^(?:fmt|format|get|to|make|build|calc|compute|render|show|pretty|human)([A-Z]\w*)$/.exec(nm);
    if (m) return clean(m[1][0].toLowerCase() + m[1].slice(1));
    return clean(nm);
  }
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) return varName(e.left);
  if (ts.isBinaryExpression(e) || ts.isPrefixUnaryExpression(e)) return 'n';
  if (ts.isAwaitExpression(e)) return varName(e.expression);
  if (ts.isTemplateExpression(e) || ts.isStringLiteralLike(e)) return 'text';
  return 'value';
}

// ── relatório ────────────────────────────────────────────────────────────────────────────────────────────────────────
function writeReport(log) {
  const files = Object.keys(log).sort();
  let nDone = 0, nSkip = 0, nDoubt = 0;
  for (const f of files) { nDone += log[f].done.length; nSkip += log[f].skipped.length; nDoubt += log[f].doubts.length; }
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '\\n');
  let md = `# Codemod dos idiomas: relatório\n\nGerado por \`node scripts/i18n/codemod.mjs\` (${new Date().toISOString().slice(0, 16).replace('T', ' ')}).\n\n`;
  md += `- **${nDone}** textos passados por \`t()\` em ${files.filter((f) => log[f].done.length).length} ficheiros\n- **${nDoubt}** marcados como duvidosos (para rever)\n- **${nSkip}** deixados de lado (parecem texto, mas o sítio ou a forma não deixam)\n\n`;
  const reasons = {};
  for (const f of files) for (const s of log[f].skipped) { const r = s.why.replace(/ \(.*\)$/, '').replace(/ de \S+\(\)$/, ' de …()').replace(/^(propriedade|atributo|variável|return|argumento de|objeto|atribuição a|valor por omissão|atribuição) .*/, '$1 …'); reasons[r] = (reasons[r] ?? 0) + 1; }
  md += `## Porque ficaram de fora (resumo)\n\n| motivo | n.º |\n|---|---|\n${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `| ${esc(r)} | ${n} |`).join('\n')}\n\n`;
  md += `## Duvidosos\n\n`;
  for (const f of files) if (log[f].doubts.length) md += `### ${f}\n\n${log[f].doubts.map((d) => `- l.${d.line}: «${esc(d.phrase)}» — ${esc(d.why)}`).join('\n')}\n\n`;
  md += `## Por ficheiro\n\n`;
  for (const f of files) {
    const e = log[f];
    md += `### ${f}\n\n`;
    if (e.done.length) md += `Transformados (${e.done.length}):\n\n${e.done.map((d) => `- l.${d.line} [${esc(d.kind)}${d.lazy ? `, ${d.lazy}` : ''}] «${esc(d.phrase)}»`).join('\n')}\n\n`;
    if (e.skipped.length) md += `De fora (${e.skipped.length}):\n\n${e.skipped.map((d) => `- l.${d.line} «${esc(d.text)}» — ${esc(d.why)}`).join('\n')}\n\n`;
  }
  fs.writeFileSync(REPORT, md);
}

// ── lista das frases (sem programa: só a árvore) ──────────────────────────────────────────────────────────────────────
function listPhrases(files) {
  const all = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const v = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't' && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        const k = n.arguments[0].text;
        all.set(k, (all.get(k) ?? 0) + 1);
        const o = n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && n.arguments[1].properties.find((p) => p.name?.getText(sf) === 'other');
        if (o && ts.isPropertyAssignment(o) && ts.isStringLiteralLike(o.initializer)) all.set(`${k}  ⟶ plural: ${o.initializer.text}`, 0);
      }
      ts.forEachChild(n, v);
    };
    v(sf);
  }
  const keys = [...all.keys()].filter((k) => !k.includes('⟶')).sort();
  const out = opt('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(keys, null, 1));
  console.log(`${keys.length} frases diferentes, ${[...all.values()].reduce((a, b) => a + b, 0)} chamadas a t()`);
}
