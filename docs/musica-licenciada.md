# Música licenciada (comercial) nos mimos e nas tchekas

Estado: **preparado e desligado**. A API já sabe falar com um fornecedor de música comercial (pesquisa, tops, excertos,
contagem do uso por faixa e por país, relatórios e remoções), mas não há contrato nem adaptador real. Hoje continua só a
música livre (ver `docs/musica.md`, da curadoria) e o programa de artistas locais.

Pesquisa feita a 2026-11-12, só com fontes públicas (ninguém foi contactado). **[2ª]** = imprensa ou fonte secundária;
**NP** = não é público.

---

## 1. Resumo e recomendação

**Hoje nenhum fornecedor vende, de forma pública e «chave na mão», música das grandes editoras para vídeo curto em Moçambique.**

- **Os produtos prontos para vídeo curto não cobrem Moçambique com música conhecida.**
  - O Feed.fm Clips está licenciado só nos EUA.
  - O catálogo mundial do Feed.fm e o da Epidemic Sound são músicas próprias, não êxitos.
- **Os agregadores dão a técnica e ajudam a negociar, mas a licença das editoras é sempre negociada país a país.** São eles a MassiveMusic (antiga 7digital) e a Tuned Global.
- **As editoras já licenciam Moçambique a plataformas africanas.** O acordo UMG–Boomplay cobre Moçambique e Angola. Portanto o país não está «fora do mapa»: é uma questão de negociar.

**Recomendação para o arranque em Moçambique, por fases:**

| Fase | O quê | Porquê |
|---|---|---|
| 0 (já) | Música livre bem escolhida e o programa de artistas locais, com licença direta assinada pelo artista ou produtor | É a única via 100% limpa hoje e dá música moçambicana (marrabenta, pandza, amapiano). |
| 0 (já) | Pôr a casa legal em ordem: licença do INTIC (Decreto 59/2023) e uma primeira conversa com o INICC e a SOMAS | Vai ser pedido em qualquer contrato com editoras. |
| 1 (3–6 meses) | Pedir propostas à **MassiveMusic (ex-7digital)** e à **Tuned Global**, para MZ, com AO e ZA como opção, só excertos até 60 s | São os dois com API para redes sociais (a MassiveMusic) ou com acordo global com a UMG e trabalho em África (a Tuned Global). Ambos dizem estruturar acordos com editoras e com a Merlin. |
| 1, em paralelo | Acordos diretos com editoras e distribuidores moçambicanos (o repertório local que as pessoas querem) e a licença da SOMAS para as obras | Pequenos, baratos e com o maior impacto local. |
| 2 | As três grandes (Sony, Universal, Warner) através do agregador escolhido, para os êxitos internacionais e sul-africanos | Exigem mínimo garantido, relatórios, remoções e identificação automática de conteúdo. Só vale a pena com escala. |
| Alternativa rápida | **Epidemic Sound Partner API** como primeiro adaptador «licensed» | Cobre o mundo inteiro, é self-service e não exige relatórios. Mas não é música conhecida: só melhora a qualidade do catálogo. |

**Fora de questão como fornecedor de licenças:**

- **Feed.fm:** só cobre os EUA para as editoras.
- **Boomplay, Audiomack e Mdundo:** são serviços de streaming e não sublicenciam. Podem ser parceiros para «ouvir a faixa completa».
- **API do SoundCloud:** proíbe uso comercial.

---

## 2. Fornecedores

### 2.1 Agregadores e plataformas B2B

| Fornecedor | UGC e vídeo curto | Territórios | Custo | Integração | Exigências | Contacto (público) |
|---|---|---|---|---|---|---|
| **MassiveMusic** (ex-7digital, grupo Songtradr) | Sim: há guias «Building a Social Media Service», com entrega gerida por eles ou pela plataforma. A licença é negociada para cada cliente («your licensing deals»). A parte dos autores é à parte (Blokur/MRI/HFA). | «Global», faixa a faixa e país a país (ISO). Não há lista de países; nada sobre MZ. | NP. Depende do catálogo, da escala e dos serviços. | API REST (150 M+ faixas): previews, streaming com `country`, feeds de catálogo incrementais, registo de uso por API ou S3 | Excertos de 0–60 s; reportar reproduções e criações; ver a disponibilidade da faixa por país; aplicar remoções dos feeds; guardar a disponibilidade diária. Parceria com a Pex (identificação de clipes). | Formulário em massivemusic.com/contact |
| **Songtradr** (B2B) | A oferta para plataformas é agora a MassiveMusic. O resto (Monetization Portal, Smart Sync, Twitch) é do lado do artista ou independente. | NP | NP | — | — | — |
| **Feed.fm** (Feed Clips) | Sim, é o produto principal. Parceria com a WMG (14/11/2025). | **Só EUA** para as editoras; fora dos EUA os pedidos são recusados. O «Feed Clips Global» cobre o mundo, só com os «Feed Originals». | Por proposta, conforme as reproduções. «A partir de 250 USD» [2ª, não verificado]. | API REST, URLs assinados (24 h), clipes até 60 s | Reportar app start/close, play, preview, add, share, download; identificação de conteúdo com a ACRCloud (bloquear ou tirar o som de vídeos com música não licenciada); revisão da app; partilha só para destinos aprovados | feed.fm/consultation; support@feed.fm |
| **MediaNet** | A marca foi absorvida pela **Audible Magic** (2021). | — | — | — | — | Ver Audible Magic |
| **Tuned Global** | «Social Media / UGC / Short-form video» ainda **[SOON]** na documentação. | Acordo global com a UMG para a música gravada (10/09/2024), só para projetos aprovados pela UMG. Em África: Nigéria, Etiópia, Gana, Costa do Marfim. Nada em MZ. | NP | APIs REST e SDKs; ingestão «Intaga»; direitos por ISO 3166; «Log Play» para relatórios; as remoções abrangem previews e metadados | Relatórios aos titulares feitos por eles | tunedglobal.com/contact |
| **Epidemic Sound** (Partner API) | Sim, mas com **catálogo próprio de música de produção** (~55k faixas), não êxitos. Sublicença para os utilizadores. | **Mundo inteiro**, sem lacunas. | Grátis para protótipos (50 downloads, sem uso comercial). Pago conforme o volume de downloads; Enterprise com um mínimo de 12 meses. Sem valores. | API REST (OpenAPI), CDN, «create versions» para cortar faixas | «No reporting»; lista de faixas autorizadas reconhecida por YouTube, TikTok e Instagram | developers.epidemicsound.com; formulário Enterprise |
| **Audiomack** | Não tem programa B2B. A API pública é de consumo e não dá direitos de sincronização com vídeo. | UMG em 16 países africanos e WMG alargada em 2025; **sem MZ** nos dois. | NP | API OAuth (pesquisa, preview) | — | NP |
| **Boomplay** | Não licencia a terceiros (só ao Vskit, do mesmo grupo) [2ª]. | O acordo com a UMG **inclui Moçambique e Angola**; a Merlin cobre 47 países africanos [2ª]. | NP | NP | — | NP |
| **Audible Magic** (com a antiga MediaNet) | Rights360: identificação (ID360), licenças «one-stop-shop» para UGC e relatórios aos titulares [2ª]. | NP | NP | Reconhecimento de clipes de ≤15 s | — | audiblemagic.com/contact |
| **Pex** | Identificação de conteúdo (Attribution Engine). | Global | Antes grátis para as plataformas, com uma parte das licenças (2019–2021; confirmar). | API | — | pex.com |

Fontes:
- [docs.massivemusic.com: social media (direct streaming)](https://docs.massivemusic.com/docs/building-a-social-media-service-direct-streaming)
- [docs.massivemusic.com: social media (self-managed)](https://docs.massivemusic.com/docs/building-a-social-media-service-self-managed-content-delivery)
- [massivemusic.com/solutions/digital-platforms](https://massivemusic.com/solutions/digital-platforms)
- [massivemusic.com: API music delivery](https://massivemusic.com/services/platform-music-delivery-services/api-music-delivery)
- [Pex e 7digital](https://pex.com/blog/7digital-and-pex-partner-to-power-new-music-identification-solution/)
- [DMN, reorganização da MassiveMusic em 2025](https://www.digitalmusicnews.com/2025/06/11/massivemusic-reorganization-june-2025/) [2ª]
- [Feed Clips, guia de implementação](https://www.feed.fm/feed-clips-implementation-guide) (lido a 2026-11-12: «licensed for use in the United States (and its territories) only»)
- [Feed Clips Global](https://www.feed.fm/clips/global-music-solution)
- [Feed.fm e WMG](https://blog.feed.fm/feed.fm-announces-partnership-with-wmg-to-bring-music-clips-to-apps)
- [Feed.fm, preços](https://www.feed.fm/pricing-page)
- [Audible Magic e MediaNet](https://www.businesswire.com/news/home/20210111005271/en)
- [Tuned Global, documentação](https://docs.tunedglobal.com/)
- [Tuned Global e UMG](https://blog.tunedglobal.com/news/tuned-global-umg-catalogue-global-licensing-agreement)
- [Tuned Global em África](https://blog.tunedglobal.com/news/tuned-global-boosts-african-music-market-growth-via-new-partnerships)
- [Epidemic Sound, visão geral da API](https://developers.epidemicsound.com/docs/overview)
- [Epidemic Sound, programadores](https://www.epidemicsound.com/business/developers/)
- [Audiomack, API](https://audiomack.com/data-api/docs)
- [Audiomack e UMG](https://www.recordoftheday.com/news-and-press/audiomack-signs-licensing-agreement-with-universal-music-group-to-expand-global-footprint-in-africa) [2ª]
- [Boomplay e UMG, 40 novos mercados (inclui Mozambique e Angola)](https://www.musicinafrica.net/node/156802) [2ª]
- [Boomplay e Merlin](https://www.myjoyonline.com/boomplay-and-merlin-extend-licensing-agreement-to-cover-47-countries-across-africa/) [2ª]
- [Audible Magic e Bolo Indya](https://www.audiblemagic.com/2022/01/24/bolo-indya-partners-with-audible-magic-to-manage-licensed-and-unlicensed-use-of-music/)
- [Pex, Attribution Engine](https://pex.com/blog/introducing-attribution-engine/)
- [SoundCloud, uso comercial da API](https://help.soundcloud.com/hc/en-us/articles/115003446727)

### 2.2 Editoras e distribuidores (acordos diretos)

| Quem | Licencia a UGC em África? | Moçambique e lusófonos | Termos | Contacto |
|---|---|---|---|---|
| **Sony Music Entertainment Africa** (Joanesburgo; Lagos, Nairobi, Acra) | Licenciou a Boomplay (2019), retirou o catálogo em dez./2024 por royalties em atraso e voltou num acordo noticiado em jul./2026 [2ª]. Os acordos com o TikTok são globais, feitos pela sede. | Não há escritório em MZ. A Sony Music France comprou a Lusafrica (Cesária Évora) em 2025 [2ª]. | NP | Não há página de parcerias; o telefone em diretório não foi verificado. |
| **Universal Music Africa / South Africa** | Licencia a Boomplay desde 2018, a Audiomack desde 2022 (16 países, sem MZ) e a Mdundo desde 2022 [2ª]. | **O acordo com a Boomplay inclui MZ e AO.** Não há escritório conhecido em Maputo ou Luanda. | NP | NP (o e-mail de licenciamento da editora na África do Sul não foi confirmado) |
| **Warner Music Africa** (Joanesburgo; comprou a Africori por inteiro em 2025) | Licencia a Audiomack e a Feed.fm (só EUA); a Africori distribui ~7.000 artistas africanos [2ª]. | Não há escritório lusófono. | NP | NP |
| **Mdundo** (cotada em Copenhaga) | É serviço de streaming, não licenciador. Tem acordos com UMG, WMG, Sony e Merlin. | Não aparece MZ no relatório anual de 2024/25. | — | Relatório anual: [inderes](https://www.inderes.se/releases/mdundocom-as-annual-report-for-the-financial-year-202425) |
| **Distribuidores e editoras moçambicanos** (MODIGI, Kongoloti Records, etc.) | Licença direta possível (masters e, se forem também editores das obras, a parte dos autores). | Repertório local. | A negociar | Diretório Music in Africa [2ª] |

Fontes:
- [Sony e Boomplay, 2019](https://www.musicbusinessworldwide.com/sony-inks-major-licensing-deal-in-africa-with-boomplay-and-its-60m-users)
- [Sony retira o catálogo da Boomplay](https://www.musicinafrica.net/magazine/sony-music-withdraws-catalogue-boomplay-amid-unpaid-royalties-dispute/)
- [Sony e Lusafrica](https://www.musicbusinessworldwide.com/sony-music-acquires-record-label-lusafrica-and-publisher-africa-nostra)
- [UMG e Mdundo](https://techcrunch.com/2022/07/08/universal-music-group-signs-licensing-deal-with-african-streaming-service-mdundo)
- [WMG compra a Africori](https://www.musicinafrica.net/magazine/warner-music-group-completes-full-acquisition-africori)
- [MODIGI, Paulo Chibanga](https://musicinafrica.net/directory-professional/paulo-chibanga/)

**Precedente útil, só para a parte dos autores:**

- O TikTok licenciou as obras de 58 territórios africanos através da **SAMRO/CAPASSO** (África do Sul, 2021), com o repertório de 21 sociedades ([fonte](https://www.recordoftheday.com/news-and-press/tiktok-strikes-multi-territory-licensing-deal-with-south-africas-samrocapasso) [2ª]).
- A CAPASSO funciona como balcão multi-território.
- Falta confirmar se a SOMAS está entre as 21 sociedades.

---

## 3. Moçambique: a lei e as sociedades

**A lei em vigor**

- **A Lei n.º 4/2001 foi revogada.** Vale a **Lei n.º 9/2022, de 29 de junho** (Lei dos Direitos do Autor e Direitos Conexos), em vigor desde setembro de 2022.
  - [WIPO Lex](https://www.wipo.int/wipolex/en/legislation/details/21426)
  - [Boletim da República](https://ts.gov.mz/wp-content/uploads/2023/09/Lei-no-9-2022-de-22-de-Junho-Lei-dos-Direitos-do-Autor-e-Direitos-Conexos-e-revoga-a-Lei-no.-4-2001-de-27-de-Fevereiro.pdf)
- **Regulamento:** Decreto n.º 46/2024, de 27 de junho ([BR n.º 124/2024](https://archive.gazettes.africa/archive/mz/2024/mz-government-gazette-series-i-dated-2024-06-27-no-124.pdf)).

**O que conta para a Txillapp**

- **Pôr música online exige autorização.** A «colocação à disposição» é um direito previsto na lei.
- **Direitos conexos:**
  - Os artistas (art. 60) e os produtores de fonogramas (art. 61) têm o direito exclusivo de autorizar a colocação à disposição. Ou seja, **é sempre preciso a licença do dono da gravação (a editora)**, além da dos autores.
  - A remuneração pela comunicação pública divide-se 50/50 entre produtor e artistas (art. 62).
  - Estes direitos duram 50 anos.
- **Usar sem autorização é crime de usurpação e é crime público** (art. 82 e seguintes).
- **Direito online dos artistas:** pelo **art. 124(3) do Regulamento**, só pode ser exercido por uma **entidade de gestão coletiva dos artistas**. Não se encontrou nenhuma habilitada. **É preciso esclarecer com o INICC.**

**Sociedades de autores**

- Há três: **SOMAS** (Sociedade Moçambicana de Autores, de 2000), SMDA e SMAutores. O INICC está a preparar um regime jurídico das entidades de gestão (agosto de 2026) [2ª].
- A SOMAS constava como membro da CISAC em 2018. **Não se confirmou se ainda é.**
- **Não há tarifário digital nem para UGC publicado** pela SOMAS, nem site ou contacto público (NP).

Fontes:
- [CISAC](https://www.cisac.org/Newsroom/articles/new-video-details-spas-lusophone-project-supporting-portuguese-speaking-society)
- [O País, sobre o regime jurídico das entidades de gestão](https://opais.co.mz/inicc-propoe-regime-juridico-para-reforcar-gestao-dos-direitos-de-autor-em-mocambique/) [2ª]

**Quem supervisiona**

- O **INICC, IP** (Instituto Nacional das Indústrias Culturais e Criativas), sob o Ministério da Cultura ([WIPO](https://www.wipo.int/es/web/country-profiles/contact?code=mz)).

**Tratados**

- Moçambique é parte de Berna (2013) e do TRIPS (é membro da OMC).
- **Não é parte do WCT, do WPPT nem de Roma** ([WIPO Lex](https://www.wipo.int/wipolex/en/members/profile/MZ)).
- Na prática, os direitos dos produtores estrangeiros entram pelos contratos com as editoras, que são globais.

**A própria plataforma precisa de licença**

- O **Decreto n.º 59/2023** obriga ao registo e licenciamento de plataformas digitais no **INTIC**.
- Primeiras licenças em junho de 2026. A partir de 2027, os operadores pagam 1% da receita anual ao Estado ([AIM](https://aimnews.org/2026/06/08/operadores-digitais-vao-pagar-1-das-receitas-ao-estado-a-partir-de-2027/) [2ª]).

**Em resumo, para tocar uma música conhecida num mimo em Moçambique são precisas:**

1. a licença do **dono da gravação** (editora ou distribuidor, ou através do agregador);
2. a licença das **obras** (SOMAS para o repertório nacional; para o estrangeiro, o agregador ou a CAPASSO);
3. a licença da **entidade dos artistas**, se existir (art. 124(3) do Regulamento);
4. a **licença do INTIC** como plataforma.

---

## 4. As lojas

**Apple, App Store Review Guidelines** ([fonte](https://developer.apple.com/app-store/review/guidelines/))

- **5.2.1:** proíbe usar obras protegidas sem permissão. A app deve ser submetida por quem detém ou licenciou os direitos.
- **5.2.2:** com conteúdo de serviços de terceiros, é preciso ter permissão expressa nos termos desse serviço. «Authorization must be provided upon request».
- **5.2.3:**
  - proíbe facilitar a partilha ilegal de ficheiros e guardar, converter ou descarregar media de terceiros sem autorização explícita;
  - lembra que o streaming também pode violar termos;
  - a autorização tem de ser mostrada se a Apple a pedir.
- **1.2 (UGC):** exige filtragem, denúncias com resposta atempada, bloqueio e um contacto público. Inclui expressamente as violações de propriedade intelectual.

**Google Play** ([Propriedade intelectual](https://support.google.com/googleplay/android-developer/answer/9888072), [UGC](https://support.google.com/googleplay/android-developer/answer/9876937))

- Não aceita apps que violem direitos de autor. O programador pode ter de **provar os direitos**.
- Exemplos de violação dados pela Google:
  - soundboards com clipes protegidos;
  - deixar descarregar cópias sem autorização;
  - incentivar o streaming e o download de música protegida.
- Exige moderação de UGC «robust, effective, and ongoing», com denúncia e bloqueio.

**O que isto quer dizer para a Txillapp:**

- **Contratos à mão:** guardar os contratos e as cartas de autorização para mostrar à Apple e à Google.
- **Nada de descarregar:** não deixar descarregar a faixa licenciada.
  - Se a app deixa guardar ou partilhar um mimo ou uma tcheka como vídeo, ou o contrato o autoriza, ou o vídeo sai **sem** a faixa licenciada.
  - A app tem de verificar isto.
- **Denúncias:** manter a denúncia de conteúdo (já existe) e juntar o motivo «direitos de autor / música».

---

## 5. Custos estimados

**Não há valores públicos para nenhum fornecedor de música das grandes editoras.** Só há estes:

- **Epidemic Sound:** um nível grátis para protótipos e um preço que depende do volume de downloads (sem valores publicados).
- **Feed.fm:** «a partir de 250 USD», segundo um agregador de software, não verificado. E não serve para Moçambique.

**A forma habitual dos contratos com editoras para vídeo curto (para pedir nas propostas e comparar):**

- **mínimo garantido (MG)** anual, pago adiantado, por território;
- **contra** uma parte das receitas, ou um valor **por utilizador ativo mensal (MAU)** nos países licenciados, conforme o que for maior;
- às vezes, um valor de arranque pela integração técnica do agregador (setup e mensalidade da plataforma);
- **mais**, à parte: a licença dos autores (SOMAS ou CAPASSO), em geral uma percentagem das receitas ou um valor por MAU;
- **mais** a identificação automática de conteúdo (ACRCloud, Pex ou Audible Magic), se o contrato a exigir.

**Para pedir nas propostas, sempre com MZ, com AO e ZA como opção:**

- MG por ano;
- valor por MAU;
- custo da plataforma e do setup;
- se a identificação de conteúdo está incluída;
- o prazo mínimo;
- se as partilhas para fora da app estão incluídas.

**Antes de assinar, o essencial:** com a música desligada, o custo é zero. O código conta o uso por faixa e por país desde o primeiro dia; com esses números, decide-se o país e o catálogo antes de aceitar um MG.

---

## 6. O que o dono tem de fazer

1. **INTIC:** confirmar a licença de plataforma digital da Txillapp (Decreto 59/2023). Já é obrigatória e vai ser pedida pelas editoras.
2. **INICC:** pedir por escrito:
   - que entidades de gestão estão habilitadas;
   - quem gere o direito online dos artistas (art. 124(3) do Regulamento).
3. **SOMAS:** pedir a licença e o tarifário para a colocação à disposição de obras numa rede social. Perguntar:
   - se é membro da CISAC e tem acordos de representação recíproca, para cobrir o repertório estrangeiro;
   - em que formato quer os relatórios.
4. **Propostas da MassiveMusic e da Tuned Global:**
   - âmbito: MZ, com AO e ZA como opção; excertos até 60 s em mimos e tchekas;
   - catálogo: grandes editoras e Merlin, mais repertório africano;
   - a perguntar: modelo de custo (MG, MAU), relatórios, remoções, identificação de conteúdo e se as partilhas e os downloads estão incluídos.
   - Os contactos estão na secção 2. A conversa é do dono, não da equipa técnica.
5. **Repertório local:**
   - licenças diretas com 3 a 5 editoras ou distribuidores moçambicanos (por exemplo MODIGI e Kongoloti);
   - os artistas do programa de artistas locais.
   - Cada contrato deve dizer:
     - **masters e obras**, ou quem gere as obras;
     - **territórios**;
     - **excertos até 60 s**;
     - **uso em publicações que ficam**: as publicações duram enquanto existirem, os mimos 24 h;
     - **relatórios**;
     - **remoção**.
6. **Contratos:** guardar cópias para as lojas (Apple 5.2 e a política de propriedade intelectual da Google).
7. **Termos de Utilização e Ajuda:** antes de ligar, acrescentar que:
   - a música licenciada não pode ser descarregada nem usada fora da app;
   - pode desaparecer das publicações se o titular a retirar.
   - O agente guardião das políticas trata disto.

---

## 7. Como funciona no código (API)

### O contrato comum

`apps/api/src/music/providers/music-provider.ts`

- A faixa comum (`MusicTrack`) tem os mesmos campos de `docs/musica.md`: `id, title, artist, duration (s), previewUrl, cover, source, license, styles[], artistUsername?`.
- O integrador alinha os nomes com a curadoria, se mudarem.
- `MusicProvider` (um adaptador por fornecedor) tem estes métodos:
  - `search(q, { country, limit })` e `trending({ country, limit })`;
  - `track(id, { country })`: devolve null se a faixa não está licenciada nesse país;
  - `previewUrl(id, { country, maxSeconds })`: devolve um endereço assinado e temporário;
  - `reportUsage(rows)`: recebe linhas agregadas `{ day, trackId, country, event, count }`;
  - `takedowns(since)`: devolve os avisos de remoção do fornecedor.

### O serviço comum

`apps/api/src/music/licensed-music.service.ts`

O serviço trata, igual para todos os fornecedores, do que os contratos exigem:

- **Territórios:** só para quem tem `identity.users.country` em `MUSIC_LICENSED_TERRITORIES`. Os outros não veem nada.
- **Uso:** cada escuta (`preview`), reprodução (`play`) e publicação (`create`) conta em `content.music_usage_daily`. É uma contagem por dia, faixa, país e tipo; **não guarda quem ouviu**.
- **Relatórios:** de 6 em 6 horas (ou à mão no backoffice), entrega os dias fechados que faltam, um relatório por dia. Voltar a correr não duplica (`content.music_usage_reports`).
- **Remoções:**
  - lê os avisos do fornecedor (`takedowns`) ou recebe uma decisão da equipa;
  - a faixa deixa de aparecer e sai dos posts, dos mimos e das notas (uma nota que era só música é apagada);
  - fica registada em `content.music_takedowns` e no registo de auditoria.
- **O que a app manda:** só `music: { kind: 'licensed', source, id }`. O servidor vai buscar o título, o artista e a capa ao fornecedor. **Não guarda endereço:** o excerto pede-se na altura.

### Rotas para a app

Todas pedem sessão iniciada. Desligada, ou fora do país, só o `status` responde; o resto dá **404**.

- `GET /api/v1/music/licensed/status`: devolve `{ enabled: false }` ou `{ enabled: true, source, clipSeconds }`.
- `GET /api/v1/music/licensed/search?q=`, `GET /api/v1/music/licensed/trending` e `GET /api/v1/music/licensed/tracks/:id`: devolvem `MusicTrack` com `previewUrl: null`.
- `POST /api/v1/music/licensed/tracks/:id/listen`, com o corpo `{ event: 'preview' | 'play' }`: devolve `{ url, expiresAt, clipSeconds }`.
  - Usa-se `preview` no seletor e `play` ao ver uma publicação.
  - Cada pedido conta para os relatórios.
- Publicar: `POST /posts`, `POST /stories` e `PUT /notes/me` aceitam `music: { kind: 'licensed', source: 'licensed', id }`.

### Rotas do backoffice

Pedem sessão de equipa.

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /api/v1/admin/music/:source/usage?from=&to=` | `stats.view` | Uso por faixa e país (até 92 dias) |
| `POST /api/v1/admin/music/:source/report` | `catalog.manage` | Entrega os dias fechados ao fornecedor |
| `POST /api/v1/admin/music/:source/takedowns/sync` | `catalog.manage` | Lê e aplica os avisos de remoção |
| `POST /api/v1/admin/music/:source/takedowns` `{ trackId, reason }` | `catalog.manage` | Retira já, mesmo com o fornecedor desligado |

### Configuração

Em `apps/api/.env`. Tudo desligado por omissão.

| Variável | Por omissão | Para quê |
|---|---|---|
| `MUSIC_LICENSED_ENABLED` | `false` | O interruptor geral |
| `MUSIC_LICENSED_DRIVER` | `none` | `fake` = catálogo simulado (só testes e desenvolvimento; proibido em produção) |
| `MUSIC_LICENSED_API_URL`, `MUSIC_LICENSED_API_KEY` | — | Credenciais do fornecedor real (só no servidor) |
| `MUSIC_LICENSED_TERRITORIES` | `MZ` | Os países do contrato (ISO, separados por vírgula) |
| `MUSIC_LICENSED_CLIP_SECONDS` | `60` | A duração máxima do excerto (5 a 60 s) |

**Migração:** `0130_musica_licenciada.sql`. Ficou num número alto de propósito; o integrador renumera depois das migrações das outras equipas de música.

### Ligar um fornecedor real

1. Escrever `apps/api/src/music/providers/<nome>.provider.ts`, que implementa `MusicProvider`. Por exemplo, para a MassiveMusic:
   - `search` e `track` usam o catálogo, com `country`;
   - `previewUrl` usa o endpoint de streaming, com o máximo de 60 s;
   - `reportUsage` usa o Preview Log API, ou o S3;
   - `takedowns` usa os feeds de remoção.
2. Acrescentar o valor ao `MUSIC_LICENSED_DRIVER` em `config.ts` e o `case` em `LicensedMusicService.createProvider()`.
3. Copiar `licensed-music.e2e.spec.ts` com `fetch` simulado para a API do fornecedor (como em `music.e2e.spec.ts`), para nada sair da máquina.
4. **Se o contrato pedir eventos que ainda não existem, é aí que se acrescentam.** Os eventos que existem são `preview`, `play` e `create`. O Feed.fm, por exemplo, pede também `share`, `download`, `app start` e `close`: acrescentam-se a `UsageEvent` e ao `CHECK` da tabela.
5. **Se o contrato exigir identificação de conteúdo** (ACRCloud, Pex ou Audible Magic) para os vídeos com som próprio, é um passo à parte no upload das tchekas. Ainda não está feito.
6. No servidor: `MUSIC_LICENSED_ENABLED=true`, o driver, as credenciais e os territórios. Só depois de assinar os contratos e de atualizar os Termos.

**Na app (das outras equipas):**

- O seletor só mostra o separador «Música conhecida» se `status.enabled`.
- O excerto vem sempre do `listen`.
- A app nunca descarrega a faixa licenciada.
