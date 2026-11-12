# Música nos mimos e nas tchekas

O seletor de música da app («Música e sons») já não pesquisa ao vivo no Openverse. O servidor mantém um **catálogo curado**:
uma tarefa periódica vai às fontes, fica só com as faixas com sinais de qualidade e licença que deixa usar, arruma-as por
estilo e guarda tudo na base de dados (`content.music_catalog`). A app lê sempre desse catálogo, nunca das fontes.

Este documento é também o **contrato com a equipa dos artistas de Moçambique** (fonte `local`, ramo `musica-artistas`).

## 1. A faixa (contrato comum)

Definida em `apps/api/src/music/catalog/track.ts` (`CatalogTrack`). Todas as fontes entregam faixas assim:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | `<fonte>:<id na fonte>`, até 80 caracteres. Ex.: `ccmixter:16626`, `local:0190d3c4-…` |
| `title` | string | até 120 |
| `artist` | string | nome artístico, para o crédito (até 120) |
| `duration` | inteiro | **segundos** |
| `previewUrl` | string | https, o áudio que se ouve e que toca no mimo/tcheka (mp3 ou m4a) |
| `cover` | string \| null | https |
| `source` | `ccmixter` \| `archive` \| `jamendo` \| `freesound` \| `local` | |
| `license` | `cc0` \| `pdm` \| `by` \| `txillapp` | `txillapp` só na fonte `local` (ver 4) |
| `licenseUrl` | string \| null | https |
| `landing` | string \| null | página original, para o crédito (https) |
| `styles` | `MusicStyleId[]` | ver 3 |
| `kind` | `music` \| `sound` | `sound` = efeito ou som solto: vai para a secção «Sons» |
| `artistUsername?` | string | só na `local`: o @ do artista no Txillapp, sem o @ |

A app recebe `PickerTrack`: a mesma faixa mais `url` (= `previewUrl`) e `durationMs` (= `duration × 1000`), os nomes antigos que
as versões antigas da app e os posts já usam, e, em «Em alta», `uses` (vezes usada nos últimos 7 dias) e `featured`. Em todas as
listas vem também `usesTotal` (vezes usada desde sempre, o «1,2 mil usos» das linhas; contado de 10 em 10 minutos) e, quando a
faixa tem capa, `coverColors: [cor1, cor2]` (`#rrggbb`), o gradiente do cartão de destaque. As cores calculam-se com sharp depois
de cada atualização do catálogo (`catalog/tint.ts`: a cor que domina a capa, escurecida para o texto branco se ler) e ficam em
`content.music_catalog.cover_tint` (migração `0132_cores_das_capas.sql`); a capa só se vai buscar por https a anfitriões
permitidos, também nos redireccionamentos. Sem cores, a app usa o gradiente da marca. Nada disto fica guardado nos posts.

O que fica guardado num post, story ou nota é a faixa no formato antigo (`id, title, artist, url, landing, license, licenseUrl,
durationMs, cover`, mais `source` e `artistUsername` quando os há). Quando o `id` existe no catálogo (ou na fonte `local`), o
servidor **substitui o que a app mandou pela versão do catálogo** (a app não consegue mudar o título, o artista nem o áudio).
Faixas escondidas no backoffice deixam de poder ser usadas.

## 2. Fontes e licenças

| Fonte | Chave | Sinais de qualidade usados | Estado |
|---|---|---|---|
| ccMixter (`ccmixter.org/api/query`) | não precisa | `upload_num_scores` (recomendações), `num_reviews` | ligada |
| Internet Archive, só a coleção **netlabels** (`advancedsearch` + `metadata`) | não precisa | `downloads`, `avg_rating` | ligada |
| Jamendo (`api.jamendo.com/v3.0/tracks`) | `JAMENDO_CLIENT_ID` | `popularity_total`, ouvidas, downloads, favoritas, nota média | desligada sem chave |
| Freesound (`freesound.org/apiv2`) | `FREESOUND_TOKEN` | `num_downloads`, `avg_rating`, `num_ratings` | desligada sem chave; só para «Sons» |
| `local` (artistas de Moçambique) | — | a da equipa dos artistas | aparece quando a fonte se regista |

- **Só entram** CC0, domínio público (PDM) e CC BY (com o crédito, que vai sempre com a faixa). **Ficam de fora** NC (o Txillapp
  é comercial), ND e SA: nas licenças CC, pôr música num vídeo cria sempre uma obra derivada («synched in timed relation with a
  moving image»), por isso ND proíbe e SA obrigaria o mimo inteiro a ficar em CC BY-SA.
- **Jamendo e Freesound:** as APIs são grátis **só para uso não comercial**; para o Txillapp é preciso pedir licença comercial
  (Jamendo: licensing@jamendo.com; Freesound: formulário de contacto). Por isso só ligam com a chave no `.env`, depois desse acordo.
- **Internet Archive:** só a coleção `netlabels` (editoras que publicam em CC). No resto do Archive há muitas gravações com direitos
  carregadas com licenças erradas.
- **Fora:** Openverse (não dá sinais de qualidade, trazia os loops de 9 segundos), Free Music Archive (API fechada), Pixabay (a API
  não tem música), Wikimedia Commons (sem sinais de qualidade).
- **Curadoria** (`catalog/curation.ts`): música entre 45 s e 7 min, sons entre 1 e 30 s; sem pré-visualização https num anfitrião
  permitido, fora; sem os mínimos de cada fonte (ex.: ccMixter ≥ 5 recomendações, Archive ≥ 300 downloads), fora; loops, samples,
  a cappellas, testes e efeitos vão para «Sons» ou ficam de fora.
- A tarefa corre de 12 em 12 horas (e no arranque, se o catálogo estiver vazio ou velho). Faixas que deixam de vir das fontes
  durante 30 dias saem das listas. No backoffice há «Atualizar agora».

## 3. Estilos e momentos

`afrobeats` Afrobeats · `amapiano` Amapiano · `pandza` Pandza · `marrabenta` Marrabenta · `kizomba` Kizomba e Zouk ·
`hiphop` Hip-hop e Trap · `rnb` R&B · `gospel` Gospel · `chill` Chill e Lo-fi · `festa` Festa · `romantico` Romântico · `praia` Praia

(`MUSIC_STYLES` em `catalog/track.ts`.) As fontes externas têm pouco ou nada de Pandza, Marrabenta e Amapiano: estes estilos
vão viver sobretudo da fonte `local`. O seletor só mostra as pastilhas dos estilos que têm faixas.

## 4. A fonte `local` (equipa dos artistas)

1. Implementar `LocalMusicSource` (`catalog/track.ts`):
   ```ts
   list(opts: { style?: MusicStyleId; q?: string; limit: number }): Promise<CatalogTrack[]>; // só publicadas, as melhores primeiro
   get(id: string): Promise<CatalogTrack | null>;                                         // null se já não estiver publicada
   ```
2. Registá-la no arranque: o vosso módulo importa `MusicModule` e, no `onModuleInit` do vosso serviço,
   `this.catalog.registerLocalSource(this)` (`MusicCatalogService`, exportado pelo `MusicModule`). Sem registo, a secção
   «Artistas de Moçambique» não aparece na app.
3. Cada faixa: `id` = `local:<uuid>`, `source: 'local'`, `license: 'txillapp'` (o artista dá ao Txillapp licença para usar a
   faixa nos mimos e nas tchekas; os termos ficam do vosso lado), `licenseUrl: null` ou a página dos termos, `artistUsername`
   preenchido, `kind: 'music'`, duração em segundos. Na integração, o `previewUrl` é o endereço assinado do trecho
   (`/api/v1/music/local/audio/…`, vale pelo menos 1 hora) e as explícitas vão com `explicit: true` (o catálogo não as mostra
   a menores de 18 anos nem a quem não deu a data de nascimento).
6. Usar a faixa (implementado pelo ArtistsService): `prepareUse(userId, id, surface)` confirma que a faixa está disponível
   para quem a usa, conta o uso e devolve o que fica guardado na publicação (com o id do ficheiro, não o endereço);
   `resolveStored(guardada)` devolve-a com o endereço do trecho outra vez válido. O MusicService chama-os através do
   catálogo (`prepareLocalUse` e `resolveLocal`), por isso o MusicModule não importa o ArtistsModule (é o ArtistsModule
   que importa o MusicModule). As faixas locais só se usam em mimos e tchekas (uma publicação com um só vídeo); em notas e
   noutras publicações o servidor recusa, e a app só as mostra com `allowLocal`.
4. Não precisam de tratar de «Em alta», «Não gosto desta», esconder nem destacar: o catálogo faz isso por `id`, para todas as fontes.
5. Migrações: `0128_musica_curadoria.sql` (catálogo) e `0131_programa_artistas.sql` (artistas).

## 5. API

Todas com sessão (`/api/v1`).

| Pedido | Resposta |
|---|---|
| `GET /music/home` | `{ styles: {id,label,kind,count}[], trending: PickerTrack[], local: PickerTrack[] \| null, sounds: boolean, recent: PickerTrack[] }` |
| `GET /music/styles/:id` | `PickerTrack[]` (até 40) |
| `GET /music/local?style=&q=&artist=` | `PickerTrack[]` (vazio sem fonte `local`); `artist` é o @ do artista |
| `GET /music/sounds` | `PickerTrack[]` |
| `GET /music/search?q=` | `PickerTrack[]`: catálogo e `local`, por título, artista ou estilo (como antes, 2 letras no mínimo) |
| `PUT /music/dislikes/:id` · `DELETE /music/dislikes/:id` | `{ disliked: true \| false }` |
| `GET /music/suggested` | versões antigas da app: `{ trending, recent }` |
| `GET /music/favorites` · `PUT /music/favorites` · `DELETE /music/favorites/:id` | as guardadas: guarda-se a faixa no formato antigo, mas a lista vem com o que o catálogo sabe agora (estilos, `usesTotal`, `coverColors`) |

### O seletor na app (`apps/mobile/src/components/MusicPicker.tsx`)

Folha escura de baixo (no computador, painel à direita), com a pesquisa e quatro separadores (`lib/musicCatalog.ts`):

| Separador | O que mostra |
|---|---|
| «Para ti» | os destaques (cartão largo com o gradiente da capa, desliza entre eles: destacadas pela equipa, até duas dos artistas de Moçambique, e as primeiras de «Em alta» se faltarem), as pastilhas pequenas («Artistas de Moçambique» e os estilos) e a lista: o estilo sugerido pelo texto do post (ou o mais guardado), «Em alta» dos estilos guardados, as usadas há pouco e o resto de «Em alta» |
| «Em alta» | `trending` |
| «Sons originais» | `GET /music/sounds` |
| «Guardadas» | as favoritas (o marcador de cada linha) |

Cada linha: capa de 56 px, título, «Artista · 1,2 mil usos · 2:53» e o marcador. Tocar ouve um pedaço (a linha fica realçada, com o
indicador de som, e aparece «Usar»); manter premido (ou «⋯» e o botão direito no computador) abre «Usar», «Ouvir», «Guardar» e
«Não gosto desta». As faixas locais e os clipes não se guardam.

- `trending` («Em alta no Txillapp»): primeiro as destacadas, depois pelo número de vezes que a faixa foi usada em mimos (stories)
  e tchekas/posts nos **últimos 7 dias** (só contagens; nada de quem usou), e completa com as de melhor qualidade.
- **«Não gosto desta»**: tira a faixa só para quem marcou, logo. Quando **pelo menos 10 pessoas** a marcam **e** são mais do que as
  vezes que foi usada nos últimos 30 dias, a faixa desce para o fim das listas e sai de «Em alta» para todos
  (`DISLIKE_MIN_PEOPLE` em `catalog/catalog.service.ts`). O backoffice mostra o limiar.

### Backoffice (`catalog.manage`)

Backoffice › Música (`/backoffice/music`) é uma só entrada com separadores: Catálogo (`catalog.manage`) e, do programa de
artistas (`music.manage`), Pedidos de artista, Faixas e Direitos de autor. A Moderação tem as duas permissões.

| Pedido | |
|---|---|
| `GET /admin/music?sort=uses\|dislikes\|quality\|recent&status=all\|featured\|hidden\|downranked&style=&q=` | `{ threshold, refreshedAt, total, styles, sources, items }` (itens com `uses7d`, `uses30d`, `dislikes`, `downranked`, `quality`, `status`) |
| `POST /admin/music/status` `{ id, status: 'active'\|'hidden'\|'featured', reason }` | 204; regista `music.hide` / `music.feature` / `music.restore` na auditoria |
| `POST /admin/music/refresh` `{ reason? }` | resumo; regista `music.refresh` |
