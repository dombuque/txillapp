// Testes da nota aberta e do editor da minha nota (src/components/Notes.tsx) e da lógica deles (src/lib/noteLook.ts).
// - NoteView: «Nome · há X» com o selo, foto e bolha ao lado (música numa linha, ou o texto lá dentro), barra de resposta
//   com três reações rápidas dentro da pílula, o Brindar fora, o Enviar só com texto, e o aviso «Enviada a @x» com «Ver».
// - NoteEditor: ecrã inteiro, a bolha onde se escreve, cor, música, local, GIF, público e «Partilhar»; a publicada apaga-se
//   com pergunta.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'components', 'Notes.tsx'), 'utf8');
const sheet = readFileSync(path.join(ROOT, 'src', 'components', 'Sheet.tsx'), 'utf8');
const chat = readFileSync(path.join(ROOT, 'src', 'app', 'messages', '[username].tsx'), 'utf8');
const look = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'noteLook.ts')).href);
const peer = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatPeerNote.ts')).href);

/** O corpo de uma função de topo (do `function Nome(` até à função de topo seguinte). */
function body(name) {
  const i = src.search(new RegExp(`\\nexport function ${name}\\(|\\nfunction ${name}\\(`));
  assert.ok(i >= 0, name);
  const rest = src.slice(i + 1);
  const j = rest.slice(1).search(/\n(?:export )?function /);
  return j < 0 ? rest : rest.slice(0, j + 1);
}

test('noteLook: cores da bolha numa lista fechada (a mesma da API) e branca por omissão', () => {
  assert.deepEqual([...look.NOTE_COLORS], ['coral', 'ambar', 'verde', 'ceu', 'noite']);
  assert.equal(look.noteTone(null), look.NOTE_WHITE);
  assert.equal(look.noteTone('roxo'), look.NOTE_WHITE, 'cor desconhecida fica branca');
  assert.equal(look.noteTone('coral').bg, '#d6334f');
  const api = readFileSync(path.join(ROOT, '..', 'api', 'src', 'chat', 'notes.service.ts'), 'utf8');
  assert.match(api, /NOTE_COLORS = \['coral', 'ambar', 'verde', 'ceu', 'noite'\] as const/);
});

test('noteLook: três reações rápidas, tiradas das dos comentários', () => {
  assert.equal(look.NOTE_QUICK.length, 3);
  const comments = readFileSync(path.join(ROOT, 'src', 'components', 'CommentsSheet.tsx'), 'utf8');
  const quick = /const QUICK = \[([^\]]+)\]/.exec(comments)[1];
  for (const e of look.NOTE_QUICK) assert.ok(quick.includes(`'${e}'`), e);
});

test('noteLook: conteúdo, disposição, campo, aviso e tempo', () => {
  assert.equal(look.noteHasContent({ body: '  ' }), false);
  assert.equal(look.noteHasContent({ body: '', gif: { id: 'x' } }), true);
  assert.equal(look.noteHasContent({ body: '', place: { name: 'Ilha' } }), true);
  assert.equal(look.noteHasContent({ body: 'olá' }), true);
  assert.equal(look.noteLayout({ music: { title: 'x' } }), 'music');
  assert.equal(look.noteLayout({ music: null }), 'text');
  assert.equal(look.noteReplyPlaceholder({ username: 'zeca', music: { title: 'x' } }), 'Responder à nota…');
  assert.equal(look.noteReplyPlaceholder({ username: 'zeca' }), 'Responder a @zeca');
  assert.equal(look.noteSentText('lina'), 'Enviada a @lina');
  const now = Date.parse('2026-11-17T12:00:00Z');
  assert.equal(look.noteAgo('2026-11-17T11:59:30Z', now), 'agora');
  assert.equal(look.noteAgo('2026-11-17T11:55:00Z', now), 'há 5 min');
  assert.equal(look.noteAgo('2026-11-16T18:00:00Z', now), 'há 18 h');
  assert.equal(look.noteAudienceLabel('mutual'), 'Seguidores', "'mutual' = quem me segue");
  assert.equal(look.noteAudienceLabel('close_friends'), 'Amigos próximos');
});

test('NoteView: cabeçalho «Nome · há X» com o selo, foto com online e bolha ao lado', () => {
  const b = body('NoteView');
  assert.match(b, /<NameWithBadge name=\{note\.displayName\} who=\{note\}/);
  assert.match(b, /noteAgo\(note\.createdAt\)/);
  assert.match(b, /online=\{online\} onlineStyle=\{styles\.onlineBig\}/);
  assert.match(b, /layout === 'music' && note\.music \? <NoteTrackLine/, 'com música, a bolha leva a música');
  assert.match(b, /layout === 'text' && !!note\.body \? <Text style=\{\[styles\.viewBubbleText/, 'sem música, o texto vai na bolha');
  assert.match(b, /layout === 'music' && !!note\.body \? <Text style=\{styles\.viewBig\}/, 'com música, o texto grande por baixo');
  assert.doesNotMatch(b, /<Sheet title=/, 'sem o título grande da folha');
  assert.doesNotMatch(b, /Abrir a conversa/);
});

test('NoteView: a música toca sozinha com o leitor de sempre (useAutoTrack)', () => {
  const t = body('NoteTrackLine');
  assert.match(t, /useAutoTrack\(track, \{ autoplay, playNow: autoplay \}\)/);
  assert.match(t, /TrackCredits/);
});

test('NoteView: pílula com o campo (foco logo) e três reações rápidas; com texto, o Enviar', () => {
  const b = body('NoteView');
  const pill = b.slice(b.indexOf('styles.replyPill'), b.indexOf('styles.cheerOut'));
  assert.match(pill, /<TextInput[\s\S]*autoFocus[\s\S]*placeholder=\{noteReplyPlaceholder\(note\)\}/);
  assert.match(pill, /\{typed \? \(\s*<SendButton[^>]*keep=\{input\}[^>]*onPress=\{\(\) => void send\(text\)\}/);
  assert.match(pill, /NOTE_QUICK\.map\(\(e\) => \(\s*<Pressable key=\{e\} disabled=\{busy\} onPress=\{\(\) => void send\(e\)\}/, 'tocar numa reação envia-a logo');
  assert.match(b, /const typed = !!text\.trim\(\);/);
});

test('NoteView: o Brindar fica fora da pílula, otimista e com a animação, âmbar quando brindado', () => {
  const b = body('NoteView');
  const out = b.slice(b.lastIndexOf('<Pressable', b.indexOf('styles.cheerOut')));
  assert.match(out, /onPress=\{\(\) => void cheer\(\)\}/);
  assert.match(out, /accessibilityState=\{\{ selected: cheered \}\}/);
  assert.match(out, /<Animated\.View style=\{\{ transform: \[\{ scale: pop \}\] \}\}>\s*<Icon name="cheers"[^>]*color=\{cheered \? colors\.amber600 : colors\.zinc800\}/);
  assert.ok(b.indexOf('styles.cheerOut') > b.indexOf('NOTE_QUICK.map'), 'o Brindar vem depois da pílula');
  assert.match(b, /setCheered\(\(c\) => !c\);\s*Animated\.sequence/, 'muda logo, antes da resposta do servidor');
  assert.match(b, /catch \(e\) \{\s*setCheered\(\(c\) => !c\);/, 'volta atrás se falhar');
});

test('NoteView: enviado, fecha e mostra «Enviada a @x» com «Ver» (na conversa só fecha e põe em dia)', () => {
  const b = body('NoteView');
  assert.match(b, /await notesApi\.reply\(note\.username, said\);\s*onClose\(\);/);
  assert.match(b, /if \(inChat\) void qc\.invalidateQueries\(\{ queryKey: \['chat-thread', note\.username\] \}\);\s*else showToast\(noteSentText\(note\.username\), \{ label: 'Ver', onPress: \(\) => router\.push\(`\/messages\/\$\{note\.username\}` as never\) \}\);/);
  assert.equal(b.split('router.push').length - 1, 1, 'já não salta logo para a conversa: só o «Ver» do aviso a abre');
});

test('Teclado: abre logo no toque (iPhone) e a folha cola-se ao teclado como as conversas', () => {
  assert.match(src, /onPress=\{\(\) => \{ primeKeyboard\(\); setViewing\(n\); \}\}/);
  assert.match(chat, /primeKeyboard\(\); setNoteOpen\(true\);/);
  assert.match(body('NoteView'), /onFocus=\{releaseKeyboard\}/);
  assert.match(sheet, /top: pinnedTop\(box\.top, parentTop\)/);
  assert.match(sheet, /getBoundingClientRect\(\)\.top/);
});

test('NoteView na conversa: leva a cor, o local, o GIF, o selo e o online', () => {
  assert.match(chat, /online=\{!!online\}/);
  assert.match(chat, /color: peerNote\.color \?\? null, place: peerNote\.place \?\? null, gif: peerNote\.gif \?\? null/);
  assert.match(chat, /verified: person\.verified/);
});

test('NoteEditor: ecrã inteiro com ×, bolha onde se escreve, paleta, música, local, GIF, público e Partilhar', () => {
  const b = body('NoteEditor');
  assert.match(b, /<Modal visible transparent/);
  assert.match(b, /accessibilityLabel="Fechar"/);
  assert.match(b, /<TextInput[\s\S]*multiline\s*autoFocus[\s\S]*placeholder=\{NOTE_PLACEHOLDER\}/);
  assert.match(src, /const NOTE_PLACEHOLDER = 'O que se passa\?';/);
  assert.match(b, /accessibilityLabel="Limpar o texto"/, 'o × pequeno da bolha limpa o texto');
  assert.match(b, /showToast\('Nota partilhada'\)/);
  assert.match(b, /accessibilityLabel="Cor da bolha"/);
  assert.match(b, /\[null, \.\.\.NOTE_COLORS\]/);
  assert.match(b, /<OptionPill a11y="Música"/);
  assert.match(b, /<OptionPill a11y="Local"/);
  assert.match(b, /<OptionPill a11y="GIF"/);
  assert.match(b, /<MusicPicker /);
  assert.match(b, /<PlaceSheet/);
  assert.match(b, /<GifPanel /);
  assert.match(b, /noteAudienceLabel\(audience\)/);
  assert.match(b, /const canShare = !busy && noteHasContent\(\{ body, music, gif, place \}\);/);
  assert.match(b, /notesApi\.set\(\{ body: body\.trim\(\), music, color, place, gif, audience \}\)/);
  assert.match(b, />Partilhar</);
});

test('NoteEditor: a nota publicada abre com o que tem e apaga-se só depois de confirmar', () => {
  const b = body('NoteEditor');
  assert.match(b, /if \(await confirm\(\{ title: 'Apagar a nota\?'[^}]*danger: true \}\)\) \{\s*void run\(\(\) => notesApi\.remove\(\)\);/);
  assert.match(b, />Apagar</);
});

test('GIF: fica no lugar da foto (quadrado arredondado) na fila, na nota aberta e no editor; só com GIF não há bolha', () => {
  const face = body('NoteFace');
  assert.match(face, /gif \? \(\s*<Image source=\{\{ uri: reduce && gif\.still \? gif\.still : gif\.url \}\} autoplay=\{!reduce\}/);
  assert.match(face, /borderRadius: Math\.round\(size \* 0\.26\)/);
  assert.match(face, /<Avatar name=\{name\} username=\{username\} size=\{size\} \/>/);
  assert.match(face, /\{online && <View style=\{\[styles\.online, onlineStyle\]\}/, 'o online fica no canto, com ou sem GIF');
  assert.match(src, /<NoteFace name=\{n\.displayName\}[^>]*gif=\{n\.gif\}/);
  assert.match(src, /<NoteFace name=\{user\.displayName\}[^>]*gif=\{mine\?\.gif\}/);
  assert.match(body('NoteView'), /<NoteFace name=\{note\.displayName\}[^>]*gif=\{note\.gif\}/);
  assert.match(src, /\{hasBubble\(n\) \? <Bubble /);
  const ed = body('NoteEditor');
  assert.match(ed, /<NoteFace [^>]*gif=\{gif\} size=\{108\} \/>/);
  assert.match(ed, /setPanel\('gifMenu'\)/);
  assert.match(ed, /title="Trocar o GIF" onPress=\{\(\) => setPanel\('gif'\)\}/);
  assert.match(ed, /title="Tirar o GIF" danger onPress=\{\(\) => \{ setGif\(null\); back\(\); \}\}/);
});

test('Fila e balão da conversa mostram a cor, o local e o GIF', () => {
  assert.match(src, /color=\{n\.color\} place=\{n\.place\?\.name\}/);
  assert.match(src, /color=\{mine\?\.color\} place=\{mine\?\.place\?\.name\}/);
  const n = { body: '', gif: { id: 'abcd' }, place: { name: 'Ilha de Moçambique' }, createdAt: '2026-11-17T10:00:00Z', expiresAt: '2026-11-18T10:00:00Z' };
  assert.ok(peer.activePeerNote(n, Date.parse('2026-11-17T12:00:00Z')), 'nota só com GIF e local vale');
  assert.deepEqual(peer.peerNoteLines(n), { text: 'GIF', track: 'Ilha de Moçambique' });
  assert.match(peer.peerNoteLabel('Ana', n), /em Ilha de Moçambique/);
});

test('Nota só com GIF e brindada: o selo do brinde vai para o canto do quadrado do GIF, como na bolha', () => {
  const badge = body('CheersBadge');
  assert.match(badge, /if \(!\(cheers > 0\)\) return null;/);
  assert.match(badge, /\{cheers > 1 && <Text style=\{styles\.cheersN\}>\{cheers\}<\/Text>\}/, 'com mais de um, a contagem');
  assert.match(body('Bubble'), /<CheersBadge cheers=\{cheers\} \/>/, 'a bolha usa o mesmo selo');
  assert.match(body('NoteFace'), /\{gif \? <CheersBadge cheers=\{cheers\} \/> : null\}/, 'só no quadrado do GIF, nunca na foto redonda');
  assert.match(src, /gif=\{n\.gif\}[^>]*cheers=\{!hasBubble\(n\) && n\.cheered \? 1 : 0\}/, 'fila: amigo com nota só GIF');
  assert.match(src, /gif=\{mine\?\.gif\}[^>]*cheers=\{mine && !hasBubble\(mine\) \? mine\.cheers \?\? 0 : 0\}/, 'fila: a minha nota só GIF, com a contagem');
});

test('Público: «Seguidores» (quem me segue) ou «Amigos próximos», no botão, na folha e na minha nota', () => {
  const ed = body('NoteEditor');
  assert.match(ed, /<Text style=\{styles\.audText\}>\{noteAudienceLabel\(view\.audience\)\}<\/Text>/, 'a etiqueta da minha nota');
  assert.match(ed, /title=\{noteAudienceLabel\(a\)\}/, 'a folha de escolha do público');
  assert.match(ed, /'Os teus seguidores\.'/);
  assert.doesNotMatch(src, /'Amigos'|Partilhar com amigos/);
});

test('Local da nota: só o nome do sítio, nunca a posição', () => {
  const ed = body('NoteEditor');
  assert.match(ed, /onChange=\{\(v\) => setPlace\(v\.trim\(\) \? \{ name: v\.trim\(\)\.slice\(0, 80\) \} : null\)\}/);
  assert.doesNotMatch(ed, /lat: g\.lat|coarse/);
});

test('Denunciar a nota: «⋯» no cabeçalho (nunca na minha), menu com «Denunciar», uma folha de cada vez', () => {
  const b = body('NoteView');
  assert.match(b, /const mine = !!user && user\.username\.toLowerCase\(\) === note\.username\.toLowerCase\(\);/);
  assert.match(b, /\{mine \? null : \(\s*<Pressable onPress=\{\(\) => setStep\('more'\)\}[^>]*accessibilityLabel="Mais opções da nota"[\s\S]*?<Icon name="more"/);
  assert.match(b, /if \(step === 'more'\) return <NoteMoreSheet [^>]*onReport=\{\(\) => setStep\('report'\)\} onClose=\{\(\) => setStep\('view'\)\} \/>;/, 'o menu fica no lugar da nota');
  assert.match(b, /<ReportSheet\s+type="note"\s+id=\{note\.username\}/);
  assert.match(b, /reported\.current = true;\s*void qc\.invalidateQueries\(\{ queryKey: \['notes'\] \}\);/, 'denunciada, sai logo da fila');
  assert.match(b, /onClose=\{\(\) => \(reported\.current \? onClose\(\) : setStep\('view'\)\)\}/, 'sem denúncia, volta à nota');
  assert.match(body('NoteMoreSheet'), /<ActionRow icon="flag" title="Denunciar"[^>]*danger onPress=\{onReport\} \/>/);
  const rs = readFileSync(path.join(ROOT, 'src', 'components', 'ReportSheet.tsx'), 'utf8');
  assert.match(rs, /note: 'esta nota'/);
  assert.match(rs, /else if \(type === 'note'\) await notesApi\.report\(id, reason, note\.trim\(\) \|\| undefined\);/);
  const api = readFileSync(path.join(ROOT, 'src', 'lib', 'api.notes.ts'), 'utf8');
  assert.match(api, /report: \(username: string, reason: ReportReason, note\?: string\): Promise<void> => raw\(`\/notes\/\$\{encodeURIComponent\(username\)\}\/report`, post\(\{ reason, note \}\)\)/);
});
