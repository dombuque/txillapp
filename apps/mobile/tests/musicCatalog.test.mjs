// Testes do seletor de música (src/lib/musicCatalog.ts e src/lib/musicSuggest.ts): os separadores que aparecem conforme o
// que o servidor manda («Artistas de Moçambique» só com a fonte local, «Sons» só quando há), as pastilhas de estilo,
// «Não gosto desta» a tirar a faixa de todas as listas, o rótulo das licenças e a sugestão de estilo pelo texto.
// E: o componente tem «Em alta no Txillapp», o botão «Não gosto desta» com Desfazer e manda só os campos de sempre.
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

test('separadores: «Em alta» e «Favoritas» sempre; «Artistas de Moçambique» só com faixas locais; «Sons» só quando há', () => {
  const ids = (h) => m.pickerTabs(h).map((x) => x.id);
  assert.deepEqual(ids(null), ['trending', 'favorites']);
  assert.deepEqual(ids({ local: null, sounds: false }), ['trending', 'favorites']);
  assert.deepEqual(ids({ local: [], sounds: false }), ['trending', 'favorites']); // fonte local sem faixas: não aparece
  assert.deepEqual(ids({ local: [t('local:1')], sounds: false }), ['trending', 'local', 'favorites']);
  assert.deepEqual(ids({ local: null, sounds: true }), ['trending', 'sounds', 'favorites']);
  assert.equal(m.pickerTabs({ local: [t('local:1')], sounds: true }).find((x) => x.id === 'local').label, 'Artistas de Moçambique');
  assert.equal(m.pickerTabs(null)[0].label, 'Em alta no Txillapp');
  assert.equal(m.hasLocal({ local: [t('local:1')] }), true);
  assert.equal(m.hasLocal({}), false);
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

test('o seletor: «Em alta no Txillapp», «Não gosto desta» com Desfazer, artistas locais e sons só quando o servidor manda', () => {
  const src = read('components/MusicPicker.tsx');
  assert.match(src, /Em alta no Txillapp/);
  assert.match(src, /accessibilityLabel="Não gosto desta"/);
  assert.match(src, /musicApi\.dislike\(/);
  assert.match(src, /musicApi\.undislike\(/);
  assert.match(src, />Desfazer</);
  assert.match(src, /pickerTabs\(home\.data\)/); // os separadores (local e sons) dependem do que o servidor manda
  assert.match(src, /musicApi\.home/);
  assert.match(src, /musicApi\.search\(/);
  assert.doesNotMatch(src, /GENRES/); // acabaram os géneros fixos na app
  assert.doesNotMatch(src, /Creative Commons\)/);
  assert.match(read('components/TrackCard.tsx'), /from '@\/lib\/musicCatalog'/);
  const api = read('lib/api.music.ts');
  assert.match(api, /'\/music\/home'/);
  assert.match(api, /\/music\/dislikes\//);
  // Para o servidor vão só os campos de sempre (mais a fonte e o @ do artista), não as contagens nem os estilos.
  assert.match(api, /const \{ id, title, artist, url, landing, license, licenseUrl, durationMs, cover, source, artistUsername \} = t;/);
});
