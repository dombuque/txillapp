// Testes do seletor de música (src/lib/musicCatalog.ts e src/lib/musicSuggest.ts): os quatro separadores («Para ti», «Em alta»,
// «Sons originais», «Guardadas»), os destaques e a lista de «Para ti», as pastilhas pequenas (artistas de Moçambique só com a
// fonte local e onde a licença deixa), «Não gosto desta» a tirar a faixa de todas as listas, guardar, os números à portuguesa
// («1,2 mil usos»), as cores dos destaques, o rótulo das licenças e a sugestão de estilo pelo texto.
// E: o componente (folha escura, linhas com capa e marcador, menu com «Não gosto desta») e o que vai para o servidor.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'musicCatalog.ts')).href);
const sg = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'musicSuggest.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\r\n/g, '\n');

const t = (id, extra = {}) => ({ id, title: `Faixa ${id}`, artist: 'Artista', url: `https://ccmixter.org/content/a/${id}.mp3`, license: 'by', ...extra });
const STYLE_IDS = ['afrobeats', 'amapiano', 'pandza', 'marrabenta', 'kizomba', 'hiphop', 'rnb', 'gospel', 'chill', 'festa', 'romantico', 'praia'];
const ids = (list) => list.map((x) => x.id);

test('separadores: «Para ti», «Em alta», «Sons originais» e «Guardadas», sempre pela mesma ordem', () => {
  assert.deepEqual(m.pickerTabs().map((x) => [x.id, x.label]), [
    ['forYou', 'Para ti'],
    ['trending', 'Em alta'],
    ['sounds', 'Sons originais'],
    ['saved', 'Guardadas'],
  ]);
  assert.equal(m.hasLocal({ local: [t('local:1')] }), true);
  assert.equal(m.hasLocal({ local: [] }), false);
  assert.equal(m.hasLocal({}), false);
});

test('pastilhas de «Para ti»: «Artistas de Moçambique» primeiro, só com faixas locais e onde a licença deixa; depois os estilos', () => {
  const styles = [{ id: 'afrobeats', label: 'Afrobeats', count: 3 }, { id: 'festa', label: 'Festa', count: 2 }];
  const home = { styles, local: [t('local:1', { source: 'local' })] };
  assert.deepEqual(m.forYouChips(home, true).map((c) => c.id), ['local', 'style:afrobeats', 'style:festa']);
  assert.equal(m.forYouChips(home, true)[0].label, 'Artistas de Moçambique');
  assert.deepEqual(m.forYouChips(home, false).map((c) => c.id), ['style:afrobeats', 'style:festa']); // notas e posts sem vídeo
  assert.deepEqual(m.forYouChips({ styles, local: null }, true).map((c) => c.id), ['style:afrobeats', 'style:festa']); // sem fonte local
  assert.deepEqual(m.forYouChips({ styles, local: [] }, true, 'festa').map((c) => c.id), ['style:festa', 'style:afrobeats']); // sugerido à frente
  assert.deepEqual(m.forYouChips(null, true), []);
});

test('destaques: as destacadas pela equipa, até duas locais (só com allowLocal) e, se forem poucas, as primeiras de «Em alta»', () => {
  const home = {
    styles: [],
    trending: [t('a'), t('b', { featured: true }), t('c'), t('d', { featured: true }), t('e')],
    local: [t('local:1', { source: 'local' }), t('local:2', { source: 'local' }), t('local:3', { source: 'local' })],
    sounds: false,
    recent: [],
  };
  assert.deepEqual(ids(m.highlights(home, true)), ['b', 'd', 'local:1', 'local:2']);
  assert.deepEqual(ids(m.highlights(home, false)), ['b', 'd', 'a']); // sem locais; completa até 3 com «Em alta»
  assert.deepEqual(ids(m.highlights({ ...home, trending: [t('x'), t('y'), t('z'), t('w')], local: null }, true)), ['x', 'y', 'z']);
  assert.deepEqual(ids(m.highlights(home, true, 3)), ['b', 'd', 'local:1']);
  assert.deepEqual(m.highlights(null, true), []);
  // Uma faixa local que venha em «Em alta» também não aparece fora dos mimos e das tchekas.
  assert.deepEqual(ids(m.highlights({ ...home, trending: [t('local:9', { source: 'local', featured: true }), t('a')], local: null }, false)), ['a']);
});

test('«Para ti»: o estilo sugerido pelo texto (ou o das guardadas), depois «Em alta» dos estilos guardados, as recentes e o resto', () => {
  const saved = [t('s1', { styles: ['praia'] }), t('s2', { styles: ['praia', 'chill'] }), t('s3', { styles: ['festa'] })];
  assert.deepEqual(m.savedStyles(saved), ['praia', 'chill', 'festa']);
  assert.equal(m.forYouStyle('gospel', saved), 'gospel'); // o texto do post manda
  assert.equal(m.forYouStyle(null, saved), 'praia'); // sem sugestão: o estilo mais guardado
  assert.equal(m.forYouStyle(null, []), null);
  const out = m.forYouList({
    styleTracks: [t('g1'), t('g2')],
    trending: [t('t1', { styles: ['hiphop'] }), t('t2', { styles: ['praia'] }), t('g1'), t('t3')],
    recent: [t('r1'), t('t3')],
    saved,
    skip: [t('t1')], // já está nos destaques
  });
  assert.deepEqual(ids(out), ['g1', 'g2', 't2', 'r1', 't3']);
  assert.equal(m.forYouList({ trending: Array.from({ length: 60 }, (_, i) => t(`n${i}`)) }).length, 40);
  assert.deepEqual(m.forYouList({}), []);
});

test('artistas de Moçambique só onde a licença deixa (allowLocal: mimos e tchekas)', () => {
  const mixed = [t('ccmixter:1', { source: 'ccmixter' }), t('local:2', { source: 'local' }), t('archive:3')];
  assert.deepEqual(m.onlyAllowed(mixed, false).map((x) => x.id), ['ccmixter:1', 'archive:3']);
  assert.equal(m.onlyAllowed(mixed, true).length, 3);
});

test('guardar: muda logo (a nova vai para o topo; tocar outra vez tira); clipes e faixas locais não se guardam', () => {
  const a = t('a');
  const b = t('b');
  assert.deepEqual(ids(m.toggleSaved([a], b)), ['b', 'a']);
  assert.deepEqual(ids(m.toggleSaved([b, a], b)), ['a']);
  assert.deepEqual(ids(m.toggleSaved(undefined, a)), ['a']);
  const list = [a];
  m.toggleSaved(list, b);
  assert.deepEqual(ids(list), ['a']); // não mexe na cache do react-query
  assert.equal(m.canSave(t('ccmixter:1', { source: 'ccmixter' })), true);
  assert.equal(m.canSave(t('freesound:1', { kind: 'sound' })), true);
  assert.equal(m.canSave(t('clip:1', { kind: 'clip' })), false);
  assert.equal(m.canSave(t('local:1', { source: 'local' })), false);
});

test('números à portuguesa: 1,2 mil; 4,4 mil; 1 M (arredonda para baixo, sem «,0»)', () => {
  const cases = [[0, '0'], [7, '7'], [999, '999'], [1000, '1 mil'], [1200, '1,2 mil'], [1299, '1,2 mil'], [2900, '2,9 mil'], [4400, '4,4 mil'], [12_500, '12,5 mil'], [99_999, '99,9 mil'], [100_000, '100 mil'], [125_400, '125 mil'], [999_999, '999 mil'], [1_000_000, '1 M'], [1_550_000, '1,5 M'], [4_400_000, '4,4 M'], [250_000_000, '250 M']];
  for (const [n, out] of cases) assert.equal(m.compactCount(n), out, String(n));
  assert.equal(m.compactCount(undefined), '0');
  assert.equal(m.compactCount(-5), '0');
  assert.equal(m.usesText(0), '');
  assert.equal(m.usesText(undefined), '');
  assert.equal(m.usesText(1), '1 uso');
  assert.equal(m.usesText(12), '12 usos');
  assert.equal(m.usesText(1234), '1,2 mil usos');
  assert.equal(m.usesText(1_000_000), '1 M usos');
});

test('a linha por baixo do título: «Artista · 1,2 mil usos · 2:53»', () => {
  assert.equal(m.rowMeta(t('a', { usesTotal: 1234, uses: 3, durationMs: 173_000 })), 'Artista · 1,2 mil usos · 2:53');
  assert.equal(m.rowMeta(t('a', { uses: 4, durationMs: 95_000 })), 'Artista · 4 usos · 1:35'); // versões antigas do servidor
  assert.equal(m.rowMeta(t('a', { usesTotal: 0, durationMs: 60_000 })), 'Artista · 1:00'); // sem usos não diz «0 usos»
  assert.equal(m.rowMeta({ id: 'x', artist: '', durationMs: null }), 'Autor desconhecido');
  assert.equal(m.rowMeta({ id: 'x', artist: '', artistUsername: 'lizha' }), '@lizha');
  assert.equal(m.rowMeta({ id: 'x', artist: '', kind: 'sound', durationMs: 4000 }), 'Som · 0:04');
});

test('cores dos destaques: as da capa (do servidor) ou o gradiente da marca', () => {
  assert.deepEqual(m.highlightColors(t('a', { coverColors: ['#4a1020', '#120408'] })), ['#4a1020', '#120408']);
  assert.deepEqual(m.highlightColors(t('a')), m.BRAND_GRADIENT);
  assert.deepEqual(m.highlightColors(t('a', { coverColors: ['red', 'blue'] })), m.BRAND_GRADIENT); // só #rrggbb
  assert.deepEqual(m.highlightColors(t('a', { coverColors: ['#4a1020'] })), m.BRAND_GRADIENT);
  assert.equal(m.BRAND_GRADIENT[0], '#d6334f');
});

test('pastilhas de estilo: só as que têm faixas; o estilo sugerido vai para a frente', () => {
  const styles = [{ id: 'afrobeats', label: 'Afrobeats', count: 3 }, { id: 'pandza', label: 'Pandza', count: 0 }, { id: 'praia', label: 'Praia', count: 9 }, { id: 'gospel', label: 'Gospel', count: 1 }];
  assert.deepEqual(m.styleChips(styles).map((s) => s.id), ['afrobeats', 'praia', 'gospel']);
  assert.deepEqual(m.styleChips(styles, 'gospel').map((s) => s.id), ['gospel', 'afrobeats', 'praia']);
  assert.deepEqual(m.styleChips(styles, 'pandza').map((s) => s.id), ['afrobeats', 'praia', 'gospel']); // sugerido sem faixas: nada muda
  assert.deepEqual(m.styleChips(null), []);
});

test('«Não gosto desta»: sai das listas soltas e de todas as partes do início, sem mexer no resto', () => {
  assert.deepEqual(m.withoutDisliked([t('a'), t('b'), t('c')], new Set(['b'])).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(m.withoutDisliked(undefined, new Set(['b'])), []);
  assert.deepEqual(m.dropFromCache([t('a'), t('b')], 'a').map((x) => x.id), ['b']);
  const home = { styles: [{ id: 'chill', label: 'Chill e Lo-fi', count: 2 }], trending: [t('a'), t('b')], recent: [t('a')], local: [t('a'), t('l')], sounds: true };
  const out = m.dropFromCache(home, 'a');
  assert.deepEqual(out.trending.map((x) => x.id), ['b']);
  assert.deepEqual(out.recent, []);
  assert.deepEqual(out.local.map((x) => x.id), ['l']);
  assert.equal(out.sounds, true);
  assert.deepEqual(out.styles, home.styles);
  assert.equal(m.dropFromCache({ ...home, local: null }, 'a').local, null);
  assert.equal(home.trending.length, 2); // não muda o original (cache do react-query)
  assert.equal(m.dropFromCache(undefined, 'a'), undefined);
});

test('licenças e crédito: CC0, domínio público, CC BY, original e artista no Txillapp; @ do artista local; vezes usada', () => {
  assert.equal(m.licenseLabel('cc0'), 'CC0');
  assert.equal(m.licenseLabel('pdm'), 'Domínio público');
  assert.equal(m.licenseLabel('by'), 'CC BY');
  assert.equal(m.licenseLabel('own'), 'Original');
  assert.equal(m.licenseLabel('txillapp'), 'Artista no Txillapp');
  assert.equal(m.creditLine({ id: 'x', artist: 'Lizha James', artistUsername: 'lizha', durationMs: 95_000 }, m.mmss), 'Lizha James · @lizha · 1:35');
  assert.equal(m.creditLine({ id: 'x', artist: '', durationMs: null }, m.mmss), 'Autor desconhecido');
  assert.equal(m.usesLabel(0), '');
  assert.equal(m.usesLabel(undefined), '');
  assert.equal(m.usesLabel(1), 'usada 1 vez esta semana');
  assert.equal(m.usesLabel(12), 'usada 12 vezes esta semana');
});

test('sugestão pelo texto: devolve sempre um dos estilos do catálogo', () => {
  assert.equal(sg.suggestMusic('Festa de aniversário hoje!')?.genre, 'festa');
  assert.equal(sg.suggestMusic('Fim de tarde na praia do Tofo')?.genre, 'praia');
  assert.equal(sg.suggestMusic('Domingo na igreja, louvor e oração')?.genre, 'gospel');
  assert.equal(sg.suggestMusic('Marrabenta em Maputo')?.genre, 'marrabenta');
  assert.equal(sg.suggestMusic('Amo-te, meu amor')?.genre, 'romantico');
  assert.equal(sg.suggestMusic('treino no ginásio')?.genre, 'hiphop');
  assert.equal(sg.suggestMusic('ok'), null);
  assert.equal(sg.suggestMusic('qwerty asdf'), null);
  for (const text of ['festa', 'praia', 'amapiano', 'pandza', 'kizomba', 'rnb soul', 'lofi chill', 'afro lagos', 'rap']) {
    const g = sg.suggestMusic(text)?.genre;
    assert.ok(STYLE_IDS.includes(g), `${text} → ${g}`);
  }
});

test('o seletor: folha escura com pesquisa, separadores, destaques, linhas com capa e marcador, e o menu com «Não gosto desta»', () => {
  const src = read('components/MusicPicker.tsx');
  // A folha escura de baixo (no computador, o painel à direita).
  assert.match(src, /<Sheet onClose=\{onClose\} full plain dark variant="panel">/);
  assert.match(read('components/Sheet.tsx'), /export const DARK = \{ bg: '#1c1c1e'/);
  assert.match(src, /placeholder="Procurar música, artista ou estilo"/);
  assert.match(src, /const tabs = pickerTabs\(\);/);
  assert.match(src, /tabOn: \{ backgroundColor: '#ffffff' \}/); // o separador ativo a branco, com o texto escuro
  assert.match(src, /tabTxtOn: \{ color: C\.bg/);
  assert.match(src, /Em alta no Txillapp/);
  // «Para ti»: destaques com o gradiente da capa e pontos; pastilhas pequenas; a lista do estilo sugerido e das guardadas.
  assert.match(src, /<LinearGradient colors=\{highlightColors\(t\)/);
  assert.match(src, /pagingEnabled/);
  assert.match(src, /const chips = forYouChips\(home\.data, allowLocal, suggestion\?\.genre\);/);
  assert.match(src, /const autoStyle = forYouStyle\(suggestion\?\.genre, favs\.data\);/);
  // As linhas: capa de 56, «Artista · usos · duração», o marcador de guardar (cheio quando guardada), a tocar realçada.
  assert.match(src, /<Cover t=\{t\} size=\{56\} radius=\{8\} active=\{active\} \/>/);
  assert.match(src, /const meta = rowMeta\(t\);/);
  assert.match(src, /<BookmarkIcon on=\{saved\}/);
  assert.match(src, /<SoundBars /);
  assert.match(src, /onMutate: \(t\) => qc\.setQueryData<Track\[\]>\(\['music-favorites'\], \(old\) => toggleSaved\(old, t\)\)/);
  // «Não gosto desta» no menu de manter premido (e no «⋯» e no botão direito do computador), com Desfazer.
  assert.match(src, /onLongPress=\{\(\) => onMenu\(t, null\)\}/);
  assert.match(src, /onContextMenu: /);
  assert.match(src, /label="Não gosto desta"/);
  assert.match(src, /<Sheet title=\{track\.title\} onClose=\{onClose\} dark variant="menu" anchor=\{anchor\}>/);
  assert.match(src, /musicApi\.dislike\(/);
  assert.match(src, /musicApi\.undislike\(/);
  assert.match(src, />Desfazer</);
  assert.match(src, /musicApi\.home/);
  assert.match(src, /musicApi\.search\(/);
  assert.doesNotMatch(src, /GENRES/); // acabaram os géneros fixos na app
  assert.doesNotMatch(src, /Creative Commons\)/);
  // Nada em inglês nos textos do seletor.
  for (const w of ['For you', 'Trending', 'Saved', 'Original sounds?', 'Use', 'Search', 'Play', 'Not interested']) assert.doesNotMatch(src, new RegExp(`['"` + '>]' + w + `['"<]`));
  assert.match(read('components/TrackCard.tsx'), /from '@\/lib\/musicCatalog'/);
  const api = read('lib/api.music.ts');
  assert.match(api, /'\/music\/home'/);
  assert.match(api, /\/music\/dislikes\//);
  assert.match(api, /usesTotal\?: number;/);
  assert.match(api, /coverColors\?: \[string, string\];/);
  // Para o servidor vão só os campos de sempre (mais a fonte e o @ do artista), não as contagens, as cores nem os estilos.
  assert.match(api, /const \{ id, title, artist, url, landing, license, licenseUrl, durationMs, cover, source, artistUsername \} = t;/);
});
