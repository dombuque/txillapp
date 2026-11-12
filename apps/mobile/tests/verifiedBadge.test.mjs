// Testes do selo de verificado em todo o sítio onde aparece o nome ou o @ de uma pessoa
// («nos mimos deve também mostrar conta verificada; em todo o sítio uma conta verificada deve vir com selo»).
// - src/components/NameWithBadge.tsx: o nome encolhe com numberOfLines, o selo fica fora do Text que encolhe e tem ~0,9× a letra;
// - cada ecrã da lista usa o selo com os campos `verified`/`verifiedTier` da pessoa (os mesmos dos posts e do perfil);
// - o cartão do convite pinta o selo a seguir ao nome.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');
const IMPORT = /import \{[^}]*\b(NameWithBadge|InlineBadge)\b[^}]*\} from '(@\/components|\.{1,2})\/(components\/)?NameWithBadge'/;

test('NameWithBadge: o nome encolhe (flexShrink, numberOfLines) e o selo fica fora do Text, sem encolher', () => {
  const s = read('components/NameWithBadge.tsx');
  // Uma linha flex: o Text do nome com numberOfLines e flexShrink; o selo noutra View, a seguir, com flexShrink 0.
  assert.match(s, /<View style=\{\[st\.row, \{ gap \}, center && st\.center, containerStyle\]\}>\s*<Text style=\{\[style, st\.name\]\} numberOfLines=\{numberOfLines\}[^>]*>\{name\}<\/Text>\s*\{who\?\.verified \? <View style=\{st\.badge\}><Badge /);
  assert.match(s, /row: \{ flexDirection: 'row', alignItems: 'center', minWidth: 0 \}/);
  assert.match(s, /name: \{ flexShrink: 1, minWidth: 0 \}/);
  assert.match(s, /badge: \{ flexShrink: 0 \}/);
  // ~0,9× a letra do nome, e segue a letra do style quando não se diz o tamanho.
  assert.match(s, /export const badgeSize = \(fontSize = 14\) => Math\.max\(10, Math\.round\(fontSize \* 0\.9\)\)/);
  assert.match(s, /const fontSize = StyleSheet\.flatten\(style\)\?\.fontSize;/);
  // Só aparece a quem é verificado; sem tier, o 'verified' (coral do Txillapp); o azul é só o 'paid'.
  assert.match(s, /if \(!who\?\.verified\) return null;\s*return <VerifiedBadge size=\{size \?\? badgeSize\(fontSize\)\} tier=\{who\.verifiedTier \?\? 'verified'\} \/>/);
  // Nas frases que quebram linha (notificações, convite), o selo vai dentro da frase, centrado na letra.
  assert.match(s, /export function InlineBadge\(\{ who, fontSize = 15 \}/);
  assert.match(s, /transform: \[\{ translateY: Math\.round\(s \* 0\.12\) \}\]/);
});

test('o tipo Badged é o mesmo par dos posts e do perfil (verified + verifiedTier)', () => {
  const api = read('lib/api.ts');
  assert.match(api, /export type VerifiedTier = 'verified' \| 'official' \| 'paid' \| null;\s*export interface Badged \{ verified\?: boolean; verifiedTier\?: VerifiedTier \}/);
});

// Cada sítio da lista: o ficheiro, o que tem de usar o selo e de onde vem a pessoa.
const SCREENS = [
  // Mimos
  ['mimos: bandeja do Início (o selo pequeno a seguir ao @, centrado)', 'components/StoriesTray.tsx', /<NameWithBadge name=\{u\.username\} who=\{u\} center gap=\{2\}/],
  ['mimos: cabeçalho do visor', 'app/stories/[username].tsx', /<NameWithBadge name=\{cur\.author\.username\} who=\{cur\.author\} style=\{st\.name\} \/>/],
  ['mimos: comentários', 'components/StoryParts.tsx', /<NameWithBadge name=\{c\.author\.username\} who=\{c\.author\}/],
  ['mimos: respostas', 'components/StoryParts.tsx', /<NameWithBadge name=\{r\.author\.displayName\} who=\{r\.author\}/],
  ['mimos: quem viu', 'components/StoryParts.tsx', /<NameWithBadge name=\{v\.displayName\} who=\{v\}/],
  ['mimos: amigos próximos', 'components/StoryParts.tsx', /<NameWithBadge name=\{f\.displayName\} who=\{f\}/],
  ['notas: o nome por baixo da foto', 'components/Notes.tsx', /<NameWithBadge name=\{n\.displayName\.split\(' '\)\[0\]\} who=\{n\} center/],
  // Mensagens
  ['mensagens: lista de conversas', 'app/(tabs)/messages.tsx', /<NameWithBadge name=\{r\.name\} who=\{r\.who\}/],
  ['mensagens: outras pessoas na pesquisa', 'app/(tabs)/messages.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['mensagens: cabeçalho da conversa', 'app/messages/[username].tsx', /titleWho=\{person \?\? listed\}/, 'passa a pessoa ao ChatHeader'],
  ['mensagens: o cabeçalho pinta o selo', 'components/ChatHeader.tsx', /<NameWithBadge name=\{title\} who=\{titleWho\} style=\{st\.name\} \/>/],
  ['grupos: quem enviou', 'components/ChatBubbles.tsx', /<NameWithBadge name=\{m\.sender\.displayName\.split\(' '\)\[0\]\} who=\{m\.sender\}/],
  ['grupos: membros', 'components/GroupSheets.tsx', /<NameWithBadge name=\{m\.displayName\} who=\{m\}/],
  ['nova conversa', 'components/GroupSheets.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\} style=\{styles\.rowName\} \/>/],
  ['grupos: pedidos para entrar', 'components/groups/GroupAccess.tsx', /<NameWithBadge name=\{r\.displayName\} who=\{r\}/],
  ['grupos: escolher membros', 'components/groups/GroupParts.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['grupos: contas do Plano', 'components/groups/PlanPanel.tsx', /<NameWithBadge name=\{b\.username === me \? 'Tu' : b\.displayName\} who=\{b\.username === me \? null : b\}/],
  ['grupos: vaquinha', 'components/groups/PotPanel.tsx', /<NameWithBadge name=\{c\.username === me \? 'Tu' : c\.displayName\} who=\{c\.username === me \? null : c\}/],
  // Publicações
  ['publicações: comentários e respostas', 'components/CommentsSheet.tsx', /<NameWithBadge name=\{c\.author\.username\} who=\{c\.author\}/],
  ['publicações: a responder a', 'components/CommentsSheet.tsx', /<InlineBadge who=\{replyTo\.author\}/],
  ['publicações: quem brindou / repostou / presenteou', 'components/PeopleSheet.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['tchekas: quem brindou / repostou', 'app/(tabs)/reels.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\} style=\{st\.personName\}/],
  ['tchekas: autor', 'app/(tabs)/reels.tsx', /<NameWithBadge name=\{post\.author\.displayName\} who=\{post\.author\} style=\{st\.authorName\}/],
  ['«X repostou»', 'components/PostCard.tsx', /<NameWithBadge name=\{post\.author\.displayName\} who=\{post\.author\} style=\{styles\.repostText\}><Text[^>]*>repostou<\/Text><\/NameWithBadge>/],
  ['identificações nas fotos (cartão)', 'components/PostCard.tsx', /<NameWithBadge name=\{`@\$\{t\.username\}`\} who=\{t\}/],
  ['identificações nas fotos (visor)', 'components/PhotoViewer.tsx', /<NameWithBadge name=\{t\.displayName \?\? t\.username\} who=\{t\}/],
  ['identificar pessoas ao publicar', 'components/PhotoTagger.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['menções ao escrever @', 'components/MentionSuggest.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['presente citado', 'components/QuoteThread.tsx', /who=\{g\.recipient\}/],
  // Outros ecrãs
  ['notificações', 'app/notifications.tsx', /<InlineBadge who=\{a\} fontSize=\{styles\.line\.fontSize\} \/>/],
  ['pesquisa: pessoas', 'app/search.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['pesquisa: menções', 'app/search.tsx', /<NameWithBadge name=\{p\.author\.displayName\} who=\{p\.author\}/],
  ['Malta para ti / SuperTxill', 'components/SuperTxillPanel.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\} style=\{s\.name\}/],
  ['sugestões no Início', 'components/Suggestions.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['sugestões no computador', 'components/DesktopShell.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['amigos nos contactos', 'components/FindContacts.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['seguidores e a seguir', 'app/u/[username]/connections.tsx', /<NameWithBadge name=\{x\.displayName\} who=\{x\}/],
  ['pedidos para seguir', 'components/ProfileSheets.tsx', /<NameWithBadge name=\{r\.displayName\} who=\{r\}/],
  ['bloqueados e escondidos dos mimos', 'components/settings/sheets.tsx', /who=\{b\} action="Desbloquear"/],
  ['À tua volta', 'app/perto.tsx', /<NameWithBadge name=\{item\.title\} who=\{item\.who\}/],
  ['locais: gestores', 'app/v/[slug]/gerir.tsx', /<NameWithBadge name=\{m\.displayName\} who=\{m\}/],
  ['locais: pagamentos recebidos', 'components/VenueTxills.tsx', /<NameWithBadge name=\{`Recebido de @\$\{person\.username\}`\} who=\{person\}/],
  ['convites: página /c/[code]', 'app/c/[code].tsx', /\{p\.displayName\}<InlineBadge who=\{p\} fontSize=\{24\} \/> convidou-te/],
  ['convites: «Convite de» no registo', 'app/register.tsx', /<InlineBadge who=\{invite\}/],
  ['chamadas: ecrã', 'components/calls/CallOverlay.tsx', /<NameWithBadge name=\{c\.peer\?\.displayName \?\? ''\} who=\{c\.peer\}/],
  ['chamadas: histórico', 'app/calls.tsx', /<NameWithBadge name=\{c\.peer\.displayName\} who=\{c\.peer\}/],
  ['Zás: visor', 'components/Instants.tsx', /<NameWithBadge name=\{own \? 'Os teus Zás' : who\.username\} who=\{own \? null : who\}/],
  ['Zás: quem viu', 'components/Instants.tsx', /<NameWithBadge name=\{v\.displayName\} who=\{v\}/],
  ['carteira: histórico', 'app/wallet.tsx', /<NameWithBadge name=\{label\} who=\{who\}/],
  ['carteira: presentear alguém', 'app/wallet.tsx', /<NameWithBadge name=\{x\.displayName\} who=\{x\}/],
  ['geleira: quem brindou', 'components/GeleiraShelf.tsx', /<NameWithBadge name=\{p\.displayName\} who=\{p\}/],
  ['partilhar no mimo: pré-visualização', 'components/ShareSheet.tsx', /<NameWithBadge name=\{`@\$\{post\.author\.username\}`\} who=\{post\.author\}/],
];

// O 4.º campo: o ecrã não pinta o selo ele próprio (passa a pessoa a um componente que o pinta).
for (const [where, file, re, via] of SCREENS) {
  test(`selo: ${where}`, () => {
    const s = read(file);
    if (!via) assert.match(s, IMPORT, `${file} importa o NameWithBadge`);
    assert.match(s, re);
  });
}

test('nenhum ecrã da lista escreve o selo à mão dentro do Text que encolhe', () => {
  for (const file of new Set(SCREENS.map(([, f]) => f))) {
    const s = read(file);
    assert.doesNotMatch(s, /numberOfLines=\{1\}>[^<]*<VerifiedBadge/, file);
  }
});

test('os dados trazem o selo: Zás, chamadas, grupos, notas e convites guardam verified/verifiedTier ao passar a pessoa', () => {
  const zas = read('components/Instants.tsx');
  assert.match(zas, /type Who = \{ username: string; displayName: string \} & Badged;/);
  assert.match(zas, /setQueue\(others\.map\(\(o\) => \(\{ username: o\.username, displayName: o\.displayName, verified: o\.verified, verifiedTier: o\.verifiedTier \}\)\)\)/);
  assert.match(read('lib/calls/types.ts'), /export interface CallPeer \{[^}]*verified\?: boolean; verifiedTier\?: 'verified' \| 'official' \| 'paid' \| null \}/);
  assert.match(read('app/messages/[username].tsx'), /startCall\(\{ username: person\.username, displayName: person\.displayName, hasAvatar: person\.hasAvatar, verified: person\.verified, verifiedTier: person\.verifiedTier \}, video\)/);
  assert.match(read('app/messages/g/[id].tsx'), /verified: m\.verified, verifiedTier: m\.verifiedTier/);
  assert.match(read('components/GroupSheets.tsx'), /verified: c\.verified, verifiedTier: c\.verifiedTier/);
  assert.match(read('components/PhotoTagger.tsx'), /verified: p\.verified, verifiedTier: p\.verifiedTier, x: pending\.x/);
  assert.match(read('app/invites.tsx'), /badge: c\?\.verified \? \(c\.verifiedTier \?\? 'verified'\) : null/);
});

const card = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inviteCard.ts')).href);
const cardInput = (over = {}) => ({ format: 'post', code: 'ABCD2345', displayName: 'Amélia Mussa', items: [], reward: 50, phrase: 0, stickerSvg: null, qr: null, hasAvatar: false, ...over });

test('cartão do convite: com conta verificada, o nome leva o selo (e espaço para ele); sem, não', () => {
  const name = (l) => l.texts.find((t) => t.text === 'Amélia Mussa');
  const plain = name(card.cardLayout(cardInput()));
  assert.equal(plain.badge, undefined);
  const v = name(card.cardLayout(cardInput({ badge: 'verified' })));
  assert.equal(v.badge, 'verified');
  assert.ok(v.maxWidth < plain.maxWidth, 'o nome encolhe antes de empurrar o selo para fora');
  assert.equal(name(card.cardLayout(cardInput({ badge: 'official' }))).badge, 'official');
  assert.equal(name(card.cardLayout(cardInput({ badge: 'paid' }))).badge, 'paid');
});

test('cartão do convite: o selo fica a seguir ao nome, com ~0,9× a letra, e os dois centram-se juntos', () => {
  const b = card.badgePlace({ x: 540, y: 572, align: 'center' }, 400, 66);
  assert.equal(b.size, Math.round(66 * 0.9));
  assert.ok(b.x > b.textX + 400, 'depois do nome');
  assert.equal(Math.round(b.textX + (400 + Math.round(66 * 0.2) + b.size) / 2), 540, 'nome + selo centrados');
  assert.ok(b.y < 572 && b.y + b.size > 572 - 66 * 0.72, 'ao meio da letra, acima da linha de base');
  const left = card.badgePlace({ x: 100, y: 50, align: 'left' }, 200, 30);
  assert.equal(left.textX, 100);
});

test('cartão do convite: o desenho e as cores do selo são os do VerifiedBadge (coral no verificado e na oficial, azul só no pago)', () => {
  const seal = /'(M22[^']+)'/.exec(read('components/VerifiedBadge.tsx'))[1];
  const coral = '<linearGradient id="seal-coral" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b81"/><stop offset="1" stop-color="#d6334f"/></linearGradient>';
  for (const tier of ['verified', 'official']) {
    const s = card.sealSvg(tier, 59);
    assert.ok(s.includes(seal) && s.includes('width="59"'), tier);
    assert.ok(s.includes('fill="url(#seal-coral)"') && s.includes(coral), `${tier}: coral`);
    assert.ok(!s.includes('#1d9bf0'), `${tier}: sem azul`);
  }
  const paid = card.sealSvg('paid', 59);
  assert.ok(paid.includes(seal) && paid.includes('fill="#1d9bf0"') && paid.includes('width="59"'));
  assert.ok(!paid.includes('linearGradient') && !paid.includes('#ff6b81'), 'pago: só azul');
  // Os dois pintores (Skia e canvas) usam o mesmo lugar e o mesmo desenho.
  for (const f of ['lib/inviteCardImage.ts', 'lib/inviteCardImage.web.ts']) {
    const s = read(f);
    assert.match(s, /badgePlace\(t, w, size\)/, f);
    assert.match(s, /sealSvg\(t\.badge, b\.size\)/, f);
  }
});

test('Ajuda: «O que querem dizer as cores do selo?» (vermelho do Txillapp, azul da verificação paga quando existir)', () => {
  const help = read('app/help.tsx');
  const m = /\{ q: 'O que querem dizer as cores do selo\?', a: '([^']+)' \}/.exec(help);
  assert.ok(m, 'a pergunta está na Ajuda');
  const a = m[1];
  assert.match(a, /vermelho[^.]*Txillapp[^.]*mérito[^.]*pedido de verificação foi aceite/);
  assert.match(a, /conta oficial do Txillapp também tem o selo vermelho/);
  assert.match(a, /azul é o da verificação paga, quando existir\./);
  // Não promete nem vende nada: nada de preços, comprar ou subscrever já.
  assert.doesNotMatch(a, /compra|preço|subscreve|Txills|loja/i);
});
