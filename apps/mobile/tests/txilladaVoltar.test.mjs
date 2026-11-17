// A Txillada (txillada-voltar): o teclado (o vídeo não encolhe), sair do ecrã sem desligar (o leitor pequeno e a pílula),
// lembrar a Txillada aberta depois de a PWA recarregar, ler os comentários para trás, as @menções (tocáveis; convidar quem
// não está a ver), a câmara desligada sem sair e reabrir a Angariação.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// O lib/txillada.ts importa o @/lib/vibes (resolve-se para o ficheiro) e tipos da app.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return { url: new URL(`../src/${spec.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const mini = await import(new URL('../src/lib/txilladaMini.ts', import.meta.url).href);
const chat = await import(new URL('../src/lib/txilladaChat.ts', import.meta.url).href);
const t = await import(new URL('../src/lib/txillada.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');
const ID = '0193a2b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

// ── 1. O teclado ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('teclado no iPhone (PWA): o palco fica com 844 px e só a barra sobe para cima do teclado', () => {
  // Sem teclado: a margem de sempre.
  assert.deepEqual(chat.liveKeyboard({ web: true, typing: false, stageH: 844, winH: 844, vv: { top: 0, height: 844 }, kb: 0, padBottom: 40 }), { open: false, barBottom: 40, visTop: 0, visBottom: 844 });
  // O teclado tapa 336 px: a zona visível (visualViewport) fica com 508; a barra sobe 336 + 8.
  const k = chat.liveKeyboard({ web: true, typing: true, stageH: 844, winH: 844, vv: { top: 0, height: 508 }, kb: 0, padBottom: 40 });
  assert.equal(k.open, true);
  assert.equal(k.barBottom, 344);
  assert.equal(k.visBottom, 508);
  // O Safari empurrou a zona visível 20 px para baixo: conta-se o fundo dela.
  assert.equal(chat.liveKeyboard({ web: true, typing: true, stageH: 844, winH: 844, vv: { top: 20, height: 508 }, kb: 0, padBottom: 40 }).barBottom, 324);
  // O teclado ainda não abriu (o foco chegou primeiro): nada muda.
  assert.equal(chat.liveKeyboard({ web: true, typing: true, stageH: 844, winH: 844, vv: { top: 0, height: 840 }, kb: 0, padBottom: 40 }).open, false);
});

test('teclado no Android: a janela encolhe (Chrome com resizes-content ou a app): só falta o que não encolheu', () => {
  // Chrome: a janela passa a 500 (o palco continua com 800).
  assert.equal(chat.liveKeyboard({ web: true, typing: true, stageH: 800, winH: 500, vv: { top: 0, height: 500 }, kb: 0, padBottom: 30 }).barBottom, 308);
  // App: a janela encolheu tudo (adjustResize) → a barra fica logo acima do teclado.
  assert.equal(chat.liveKeyboard({ web: false, typing: true, stageH: 800, winH: 500, vv: null, kb: 300, padBottom: 30 }).barBottom, 308);
  // iPhone (app): a janela não encolhe; o teclado de 300 tapa o fundo.
  assert.equal(chat.liveKeyboard({ web: false, typing: true, stageH: 844, winH: 844, vv: null, kb: 300, padBottom: 40 }).barBottom, 308);
  // Os comentários a flutuar não sobem acima da parte que se vê.
  assert.equal(chat.floatHeight(270, { stageH: 844, floatBottom: 600, visTop: 0, header: 16 }), 228);
  assert.equal(chat.floatHeight(270, { stageH: 844, floatBottom: 200, visTop: 0, header: 16 }), 270);
  assert.equal(chat.floatHeight(270, { stageH: 844, floatBottom: 800, visTop: 0, header: 16 }), 72, 'nunca menos de 72');
});

test('o ecrã: o palco medido sem o teclado (fica parado ao escrever) e a barra sobe com liveKeyboard', () => {
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /still\.current = stableScreen\(still\.current, \{ w: width, h: rootH \|\| height \}, writing\)/);
  assert.match(s, /const barBottom = K\.barBottom;/);
  assert.match(s, /useVisibleViewport\(\)/);
  // Na web, com o teclado, a altura fixa em px (não o 100dvh que encolhia com a janela).
  assert.match(s, /web && writing \? \(\{ height: H, bottom: 'auto' \}/);
  // A escrever, só a fila de comentar (os balões descem para cima dela).
  assert.match(s, /const blockH = typing \? 44 : 44 \+ 8 \+ 44;/);
});

// ── 2. Sair do ecrã sem desligar ─────────────────────────────────────────────────────────────────────────────────────

test('o leitor pequeno: no ecrã da Txillada nada; quem vê tem o vídeo; o anfitrião e quem transmite a pílula', () => {
  assert.equal(mini.onTxilladaScreen(`/txillada/${ID}`, ID), true);
  assert.equal(mini.onTxilladaScreen(`/txillada/${ID}/`, ID), true);
  assert.equal(mini.onTxilladaScreen('/u/zeca', ID), false);
  assert.equal(mini.onTxilladaScreen(null, ID), false);
  assert.equal(mini.miniMode({ onScreen: true, kind: 'live', host: false, onStage: false }), 'none');
  assert.equal(mini.miniMode({ onScreen: false, kind: 'live', host: false, onStage: false }), 'video');
  assert.equal(mini.miniMode({ onScreen: false, kind: 'live', host: true, onStage: false }), 'host');
  assert.equal(mini.miniMode({ onScreen: false, kind: 'live', host: false, onStage: true }), 'host');
  assert.equal(mini.miniMode({ onScreen: false, kind: 'ended', host: false, onStage: false }), 'ended');
  assert.equal(mini.miniMode({ onScreen: false, kind: 'locked', host: false, onStage: false }), 'none');
  assert.equal(mini.miniPillText('host', { host: true, hostUsername: 'zeca' }), 'Estás ao vivo · Voltar');
  assert.equal(mini.miniPillText('host', { host: false, hostUsername: 'zeca' }), 'Estás a transmitir · Voltar');
  assert.equal(mini.miniPillText('video', { host: false, hostUsername: 'zeca' }), 'Ao vivo · @zeca · Voltar');
  assert.equal(mini.miniPillText('ended', { host: true, hostUsername: 'zeca' }), 'A tua Txillada acabou · Ver o resumo');
});

test('o leitor pequeno arrasta-se e fica encostado a um lado, por cima da barra dos separadores', () => {
  const screen = { w: 390, h: 844 };
  const safe = { top: 50, bottom: 100 };
  const size = mini.miniSize(screen);
  assert.deepEqual(size, { w: 117, h: 208 });
  assert.deepEqual(mini.miniStart(size, screen, safe), { x: 390 - 117 - 12, y: 844 - 100 - 208 - 12 });
  assert.deepEqual(mini.miniSnap({ x: 40, y: 300 }, size, screen, safe), { x: 12, y: 300 });
  assert.deepEqual(mini.miniSnap({ x: 300, y: -50 }, size, screen, safe), { x: 261, y: 62 }, 'não passa do topo seguro');
  assert.equal(mini.miniSnap({ x: 300, y: 2000 }, size, screen, safe).y, 524, 'nem para baixo da barra');
  assert.equal(mini.isTap(2, 3, 120), true);
  assert.equal(mini.isTap(30, 3, 120), false);
  assert.equal(mini.isTap(2, 3, 900), false);
});

test('a Txillada aberta fica lembrada (a PWA recarregar ao voltar) durante 30 min depois da última vez ligada', () => {
  const o = { id: ID, host: 'zeca', hostName: 'Zeca', isHost: false };
  const raw = mini.encodeOpen(o, 1000);
  assert.deepEqual(mini.decodeOpen(raw, 1000 + 60_000), o);
  assert.equal(mini.decodeOpen(raw, 1000 + mini.OPEN_KEEP_MS + 1), null, 'velha demais');
  assert.equal(mini.decodeOpen(raw, 1000 - 120_000), null, 'do futuro');
  assert.equal(mini.decodeOpen('{"v":{"id":"../x","host":"a"},"at":1}', 1), null, 'um id estranho');
  assert.equal(mini.decodeOpen('lixo', 1), null);
  assert.equal(mini.decodeOpen(null, 1), null);
});

test('a sessão vive no layout raiz: o ecrã abre-a e só Sair, o X e Feito a fecham', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /\{user \? <TxilladaSessionHost key=\{user\.id\} \/> : null\}/);
  assert.match(layout, /\{user \? <TxilladaMini \/> : null\}/);
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /useEffect\(\(\) => \{ openTxillada\(sid\); \}, \[sid\]\);/);
  assert.match(s, /const tx = useTxilladaSession\(sid\);/);
  assert.doesNotMatch(s, /useTxillada\(String\(id\)\)/, 'a sala já não vive no ecrã');
  assert.match(s, /const leave = \(\) => \{\n\s+closeTxillada\(\);/);
  // Sair do ecrã sem estar a decorrer (acabada, a pagar, erro) fecha; a decorrer fica (o leitor).
  assert.match(s, /if \(kindRef\.current !== 'live'\) closeTxillada\(\);/);
  // O anfitrião no Android: voltar já não pergunta para terminar (sair do ecrã não termina; fica a pílula).
  assert.doesNotMatch(s, /hardwareBackPress/);
  const sess = read('lib/txilladaSession.tsx');
  assert.match(sess, /return id \? <Session key=\{id\} id=\{id\} \/> : null;/, 'outra Txillada começa do zero');
  assert.match(sess, /useEffect\(\(\) => \(\) => closeTxillada\(false\), \[\]\);/, 'sair da conta desliga');
  assert.match(sess, /return live \? <KeepAwake \/> : null;/);
  // O mini usa o TxilladaVideo (no Android remonta a cada «restarted» da faixa, 877a95a).
  assert.match(read('components/txillada/TxilladaMini.tsx'), /<TxilladaVideo track=\{track\} fit="cover" box=\{size\}/);
  assert.match(read('components/txillada/TxilladaVideo.tsx'), /t\.on\('restarted', bump\)/);
});

// ── 3. Ler os comentários para trás ──────────────────────────────────────────────────────────────────────────────────

test('ler para trás: «N comentários novos», o fim da lista, o topo e o cursor dos antigos', () => {
  assert.equal(chat.atEnd(500, 300, 820), true);
  assert.equal(chat.atEnd(400, 300, 820), false);
  assert.equal(chat.nearTop(30), true);
  assert.equal(chat.nearTop(200), false);
  assert.equal(chat.newSince(['a', 'b', 'c', 'd'], 'b'), 2);
  assert.equal(chat.newSince(['a', 'b'], 'b'), 0);
  assert.equal(chat.newSince(['a', 'b'], null), 0);
  assert.equal(chat.newSince(['a', 'b'], 'zz'), 0, 'o que vi já saiu: nada');
  assert.equal(chat.newLabel(0), '');
  assert.equal(chat.newLabel(1), '1 comentário novo');
  assert.equal(chat.newLabel(7), '7 comentários novos');
  assert.equal(chat.newLabel(150), '99+ comentários novos');
  assert.equal(chat.oldestId([{ id: 'gift:1', gift: { amount: 5 } }, { id: 'c2' }, { id: 'c3' }]), 'c2', 'as ofertas não vão à API');
  assert.equal(chat.oldestId([]), null);
  assert.equal(chat.keepOffset(10, 1000, 1600), 610, 'chegaram 600 px por cima');
});

test('ler para trás: a API dá `before` e `more`, a sala guarda até 1000 e o ecrã usa a lista que rola', async () => {
  const api = read('lib/api.txillada.ts');
  assert.match(api, /before \? `\?before=\$\{id\(before\)\}`/);
  assert.match(api, /Promise<\{ items: TxilladaComment\[\]; more\?: boolean \}>/);
  const room = read('lib/txilladaRoom.ts');
  assert.match(room, /if \(first\) setOlderMore\(r\?\.more === true\);/);
  assert.match(room, /const r = await txilladaApi\.comments\(id, null, before\);/);
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /<LiveComments\n/);
  assert.match(s, /onLoadOlder=\{\(\) => void tx\.loadOlder\(\)\}/);
  const list = read('components/txillada/LiveCommentList.tsx');
  // Arrastar na vertical (também por cima de um balão) abre a lista; um toque num balão continua a abrir o menu.
  assert.match(list, /onMoveShouldSetPanResponderCapture: \(_e, g\) => Math\.abs\(g\.dy\) > 10/);
  assert.match(list, /onPress=\{open\} onLongPress=\{open\}/);
  assert.match(list, /testID="txillada-new-comments"/);
  assert.match(list, /c\.author\.verified \? <InlineBadge who=\{c\.author\} fontSize=\{14\} \/> : null/, 'o selo também na lista');
});

// ── 4 e 5. As @menções ───────────────────────────────────────────────────────────────────────────────────────────────

test('as @menções no texto: tocáveis, com as mesmas regras do servidor (sem emails, o ponto final fora)', () => {
  assert.deepEqual(chat.mentionParts('olá @ana e @rui.'), [{ t: 'text', s: 'olá ' }, { t: 'at', u: 'ana' }, { t: 'text', s: ' e ' }, { t: 'at', u: 'rui' }, { t: 'text', s: '.' }]);
  assert.deepEqual(chat.mentionParts('mail a@b.com'), [{ t: 'text', s: 'mail a@b.com' }]);
  assert.deepEqual(chat.mentionParts('@zé'), [{ t: 'text', s: '@zé' }], 'só letras do @username');
  assert.deepEqual(chat.mentionParts('sem nada'), [{ t: 'text', s: 'sem nada' }]);
  assert.deepEqual(chat.mentionParts('@ab'), [{ t: 'text', s: '@ab' }], 'curto demais');
});

test('as @menções: o aviso de quem está a ver, o convite de quem não está e a nota na lista do @', () => {
  const ev = chat.parseMentionEvent({ type: 'txillada.mention', txilladaId: 't1', commentId: 'c1', from: { username: 'ana', verified: true, verifiedTier: 'paid' } }, 't1');
  assert.deepEqual(ev, { type: 'txillada.mention', txilladaId: 't1', commentId: 'c1', from: { username: 'ana', verified: true, verifiedTier: 'paid' } });
  assert.equal(chat.parseMentionEvent({ type: 'txillada.mention', txilladaId: 't2', from: { username: 'ana' } }, 't1'), null, 'de outra Txillada');
  assert.equal(chat.parseMentionEvent({ type: 'txillada.comment', txilladaId: 't1' }, 't1'), null);
  assert.equal(chat.mentionNotice('ana'), '@ana mencionou-te num comentário');
  assert.equal(chat.invitedNotice(['rui']), 'Convidaste @rui para vir ver a Txillada');
  assert.equal(chat.invitedNotice(['rui', 'zeca']), 'Convidaste 2 pessoas para vir ver a Txillada');
  assert.equal(chat.invitedNotice([]), null);
  assert.equal(chat.invitedNotice(undefined), null);
  assert.equal(chat.suggestNote({ inTxillada: false, invitable: true }), 'Convida-se ao mencionar');
  assert.equal(chat.suggestNote({ inTxillada: true, invitable: false }), null);
  assert.equal(chat.suggestNote({}), null);
});

test('as @menções: o contexto txillada nas sugestões, os balões tocáveis e o aviso na lista das notificações', () => {
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /useMentionSuggest\(\{ text, setText: \(t\) => setText\(t\.slice\(0, COMMENT_MAX\)\), inputRef, context: 'txillada', id \}\)/);
  assert.match(s, /<MentionSuggest mention=\{mention\} style=\{st\.mentions\} \/>/);
  assert.match(s, /onMention=\{openProfile\}/);
  assert.match(read('lib/api.ts'), /export type MentionSuggestContext = 'post' \| 'group' \| 'story' \| 'zas' \| 'chat' \| 'txillada';/);
  assert.match(read('components/MentionSuggest.tsx'), /suggestNote\(p\) \? <Text style=\{st\.note\}/);
  // Nas publicações, o @ sozinho já pede pessoas (a pesquisa com q vazio; o servidor devolve as mais próximas).
  const ms = read('components/MentionSuggest.tsx');
  assert.match(ms, /enabled: debounced !== null,/);
  assert.match(read('lib/mentions.ts'), /case 'anfitriao': return t\('Anfitrião'\);/);
  assert.match(read('components/StoryFloatComments.tsx'), /\{onMention \? <MentionText text=\{text\} onMention=\{onMention\} \/> : text\}/);
  // O toque num @ não abre também o menu do comentário.
  assert.match(read('components/txillada/MentionText.tsx'), /stopPropagation\?\.\(\);\n\s+onMention\(p\.u\);/);
  assert.equal(t.inviteNoticeText({ mention: true, host: { username: 'zeca' } }, 'ana'), 'mencionou-te na Txillada de @zeca: vem ver');
  assert.equal(t.inviteNoticeText({ mention: true, host: { username: 'zeca' } }, 'zeca'), 'mencionou-te na Txillada: vem ver');
  assert.equal(t.inviteNoticeText({ title: 'Bom dia' }, 'zeca'), 'convidou-te para transmitir na Txillada: Bom dia');
  assert.equal(t.inviteNoticeSub({ status: 'live' }, { mention: true }), 'Toca para ver');
  assert.equal(t.inviteNoticeSub({ status: 'live' }), 'Entra e aceita o convite');
  assert.equal(t.inviteNoticeSub({ status: 'ended' }, { mention: true }), 'Já acabou');
});

// ── 8. A câmara desligada sem sair ───────────────────────────────────────────────────────────────────────────────────

test('câmara: o anfitrião desliga-a sem terminar (foto e «Câmara desligada»); o convidado desliga e fica a ver', () => {
  assert.equal(chat.CAM_OFF(), 'Câmara desligada');
  assert.equal(chat.camLabel(true), 'Desligar a câmara');
  assert.equal(chat.camLabel(false), 'Ligar a câmara');
  const room = read('lib/txilladaRoom.ts');
  assert.match(room, /if \(cam\) await v\.mute\(\); else await v\.unmute\(\);/, 'a faixa fica publicada (calada): a sala não cai');
  assert.match(room, /cam: !!vp && !vp\.isMuted/, 'quem vê sabe que a câmara está desligada');
  const g = read('components/txillada/TxilladaGuests.tsx');
  assert.match(g, /if \(t && !t\.cam\) \{/);
  assert.match(g, /testID="txillada-cam-off"/);
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /function guestCamOff\(\) \{\n\s+void tx\.leaveStage\(\)/);
  assert.match(s, /<GlassButton label=\{camLabel\(tx\.cam\)\} on=\{!tx\.cam\} onPress=\{hostCam\}>/);
  // Com a câmara desligada não é «A ligar…».
  assert.match(s, /const waiting = !tx\.tiles\[0\]\?\.track && tx\.tiles\[0\]\?\.cam !== false;/);
});

// ── 7. Reabrir a Angariação ──────────────────────────────────────────────────────────────────────────────────────────

test('reabrir a Angariação: a rota, a sala volta ao vivo do zero (a conversa fica) e o resumo mostra o botão', () => {
  assert.match(read('lib/api.txillada.ts'), /reopen: \(txilladaId: string\): Promise<TxilladaDto> => raw\(`\/txilladas\/\$\{id\(txilladaId\)\}\/reopen`, post\(\{\}\)\)/);
  const room = read('lib/txilladaRoom.ts');
  assert.match(room, /case 'reopen': return \{ \.\.\.initialLive\(a\.dto\), comments: s\.comments, removed: s\.removed \};/);
  const s = read('app/txillada/[id].tsx');
  assert.match(s, /const canReopen = !!dto\?\.canReopen && !cut && dto\.goal != null && !resumeUntil;/);
  assert.match(read('components/txillada/TxilladaParts.tsx'), /label=\{t\('Reabrir a Angariação'\)\}/);
  // O estado: reaberta, volta a 'live' (um fim normal não volta).
  const ended = { ...t.initialLive(), status: 'ended' };
  assert.equal(t.withDto(ended, { id: 'x', status: 'live', viewers: 0, peakViewers: 0, cheers: 0, comments: 0 }).status, 'ended');
});

test('reabrir: a notificação diz «reabriu a Txillada» (data.reopened)', () => {
  assert.equal(t.noticeText({ title: 'Ajuda à escola', reopened: true }), 'reabriu a Txillada: Ajuda à escola');
  assert.equal(t.noticeText({ reopened: true }), 'reabriu a Txillada');
  assert.equal(t.noticeText({ title: 'Ajuda à escola' }), 'abriu uma Txillada: Ajuda à escola');
});
