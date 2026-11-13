# O estúdio das tchekas na app nativa (Android e iPhone)

O site monta a tcheka no próprio browser (`apps/mobile/src/components/TchekaStudio.tsx`: canvas 1080×1920 + MediaRecorder).
No telemóvel o mesmo import (`@/components/TchekaStudio`) resolve para **`TchekaStudio.native.tsx`**: a edição faz-se na app e a
montagem no servidor (`POST /tchekas/compose`, docs/montagem.md). O modelo é o mesmo nos dois lados (`lib/studio/project.ts`,
`history.ts`, `effects.ts`, `audioMix.ts`, `magic.ts`, `capulana.ts`, `tchekaRules.ts`): o rascunho, as regras e o JSON dos
efeitos são iguais.

Nenhum módulo nativo novo: usa o que a app já tinha (expo-video, expo-audio, expo-image, expo-font, expo-file-system,
expo-image-picker, expo-haptics, react-native-gesture-handler, reanimated, react-native-svg e a **Skia**, que já servia o editor
de fotos). As 10 fontes do texto entram como TTF em `assets/fonts/estudio` (OFL, as mesmas famílias do site e do servidor).

## 1. Ficheiros

| Ficheiro | O que é |
| --- | --- |
| `components/TchekaStudio.native.tsx` | O ecrã: o projeto com desfazer/refazer, as regras, os separadores, «Seguinte» |
| `components/studio/native/NativeStage.tsx` | A pré-visualização: um leitor por clipe (o de agora, o anterior na transição, o seguinte à espera) |
| `components/studio/native/NativeOverlays.tsx` | Textos e stickers por cima, com as animações e os gestos (arrastar, rodar, escalar, guias) |
| `components/studio/native/NativeTimeline.tsx` | A linha do tempo: cursor ao meio, miniaturas, pegas, reordenar, pinça, faixas das camadas |
| `components/studio/native/NativeClipActions.tsx` | Dividir, Duplicar, Velocidade/Duração, Som do vídeo, Substituir, Apagar |
| `components/studio/native/NativeFxPanel.tsx`, `NativeFilterStrip.tsx` | Filtros, ajustes, transições, rampas, inverter, congelar |
| `components/studio/native/NativeSoundPanel.tsx`, `NativeVoice.tsx` | Música e trecho, mistura, voz-off, efeitos de voz e sonoros, moldes |
| `components/studio/native/NativeComposeOverlay.tsx` | O progresso da montagem, os erros e o vídeo montado para publicar |
| `components/studio/native/clockStore.ts`, `usePreviewAudio.ts`, `useFrameGrab.tsx` | O relógio, o som da pré-visualização, congelar um frame |
| `lib/studio/previewClock.ts` | As contas do relógio (puras, testadas) |
| `lib/studio/composeRequest.ts` | Projeto → pedido de montagem (puro, testado), e o pedido «compatível» para um servidor mais antigo |
| `lib/studio/composeJob.ts`, `composeRunner.ts` | «Seguinte»: o que enviar, fases, erros, retoma (puro, testado) e a rede |
| `lib/studio/nativeDraftFiles.ts`, `studioStore(.native).ts` | Os rascunhos em ficheiros e o registo da montagem (`job.json`) |
| `lib/studio/mp3Envelope.ts`, `nativeAudio.ts` | A onda e o ritmo da música lidos do MP3; os efeitos sonoros em WAV |
| `components/studio/native/SkiaVideo.tsx`, `lib/studio/nativeVideoFx.ts` | O filtro completo nas fotos e nos vídeos (Skia: o shader do site e o vídeo ao ritmo do relógio; as contas puras e testadas) |
| `lib/studio/nativeLook.ts` | A aproximação dos filtros nos vídeos que não vão pela Skia (pura, testada) |
| `components/studio/native/useVoicePreview.ts`, `lib/studio/voicePreview.ts` | Os efeitos de voz a ouvir: o servidor prepara o som com o efeito (`POST /tchekas/compose/voice-preview`) |
| `lib/studio/magicAnalyzeNative.ts`, `magicAnalyze.native.ts` | A análise da Montagem mágica no telemóvel (e a API do site sem browser, para o código do site não entrar na app) |
| `components/studio/native/NativeMagic.tsx`, `useMagicFrames.tsx` | A Montagem mágica no estúdio nativo e a grelha escondida que lê os frames dos vídeos |
| `lib/studio/magicFrames.ts` | As contas dos frames dos vídeos: grelha, corte 9:16, lotes no tempo, a resposta do som (puro, testado) |
| `lib/studio/magicUploads.ts`, `magicSound.ts`, `nativeVideoAudio.ts` | Os vídeos enviados ao abrir a Montagem mágica, o som pedido ao servidor e o «tem pista de áudio?» do leitor |
| `lib/studio/nativeFonts.ts` | As 10 fontes (expo-font) |

Testes: `tests/studioCompose`, `studioComposeJob`, `studioPreviewClock`, `studioNativeDrafts`, `studioMp3`, `studioNativeLook`,
`studioMagicFrames`, `studioNativeVideoFx`, `studioVoicePreview`; no servidor, `apps/api/src/compose/analyze.spec.ts`,
`analyze.e2e.spec.ts` e `voice-preview.e2e.spec.ts`.

## 2. Como funciona

- **Ecrã**: em cima, fechar, «Nova tcheka» e «Seguinte» (com a dica das regras por baixo, a mesma do site). A imagem 9:16 fica
  com a altura que sobra; por baixo, tocar/pausa, «0:07 / 0:20», desfazer e refazer; depois a linha do tempo e a barra do clipe
  escolhido. Os separadores (Clipes, Som, Texto, Stickers, Efeitos, Capa) estão numa folha com três alturas: **baixa** (só os
  separadores; vê-se a linha do tempo), **média** (o painel no lugar da linha do tempo) e **alta** (62 % do ecrã; abre sozinha
  com o teclado). Tocar no separador escolhido abre e fecha; a pega (ou arrastar na fila) muda a altura. Alvos de 44 px e letra
  de 14 px no mínimo.
- **Relógio**: um só (`clockStore`). Cada leitor segue-o sozinho: os vídeos (corte, velocidade, rampa com `playbackRateAt`, som
  do clipe × som dos vídeos; corrige-se quando se afasta mais de 0,3 s), a música (do trecho, em ciclo, com os fades e o ducking
  por baixo da voz-off), a voz-off e os efeitos sonoros (o mesmo `synthSfx`, em WAV).
- **Filtros**: nas fotos e nos vídeos, o filtro completo pela Skia, com o mesmo shader do site (`renderGL.ts` → `FX_SKSL` em
  `nativeVideoFx.ts`): nitidez 3×3, a matriz de `resolveFx`, a vinheta cos⁴ (a do ffmpeg) e o grão (semente por frame nos
  vídeos). O Canvas tem o tamanho da imagem no ecrã. Os vídeos abrem-se com o `Skia.Video` (o objeto do `useVideo` da Skia
  2.14), mas o ritmo é do estúdio, porque o `useVideo` não serve tal como está (lido em `node_modules/@shopify/react-native-skia`):
  - no **Android** (`RNSkVideo.java`) cada `nextImage()` descodifica o frame seguinte sem olhar para o tempo (o `useVideo`
    chama-o a cada frame do ecrã: um vídeo de 30 fps num ecrã de 60/120 Hz andava 2 a 4× mais depressa); o `seek` (em **ms**)
    cai no keyframe anterior (`SEEK_TO_CLOSEST_SYNC`); não há velocidade; o som é um `MediaPlayer` à parte, a 1×; só dá frames
    novos enquanto «toca»; e o objeto não liberta o descodificador quando se larga (fica para o recolhedor do Java);
  - no **iPhone** (`RNSkAppleVideo.mm`) o AVPlayer toca a 1× sozinho; o `seek` é exato; não há velocidade.

  Por isso, em cada frame do ecrã (no fio da interface, `useFrameCallback`), vê-se onde o relógio quer o vídeo e pede-se só o
  que falta (`androidPace`: até 4 frames por frame do ecrã; para trás, ou mais de 2,5 s à frente, salta e descodifica para a
  frente até ao frame certo, por isso o início de cada corte fica exato: o clipe seguinte prepara-se escondido); no iPhone toca a
  1× e corrige-se com saltos exatos (`applePace`). O vídeo da Skia vai **calado**: o som do clipe toca num leitor do expo-video
  sem imagem (`ClipAudio`), com a velocidade, a rampa, o volume e o efeito de voz (o caminho que já estava provado).
  Só o clipe de agora e o seguinte (e o anterior durante a transição) estão vivos; os vídeos da Skia guardam-se e reutilizam-se
  (4 parados no máximo) e há um teto de 12 por estúdio. Enquanto o primeiro frame não chega, vê-se a miniatura do corte.
  Ficam no **caminho antigo** (expo-video com camadas que aproximam o filtro, e o aviso «a imagem final fica com o filtro
  completo»): os clipes ao contrário; no iPhone, os clipes com outra velocidade ou rampa; Android antes da API 26; um ficheiro que
  a Skia não abra ou que não dê um frame em 5 s (fica registado: `console.warn` «vídeo da Skia: …»); depois de 2 falhas, a
  sessão toda. `SKIA_VIDEO = false` em `NativeStage.tsx` desliga tudo.
- **Efeitos de voz** (Robô, Esquilo, Grave, Eco, Rádio, Estádio): ao escolher um, a app envia o ficheiro (a voz-off como
  `purpose: 'chat'`, o clipe de vídeo como na montagem; o envio fica em `job.json` e o «Seguinte» já não o repete) e pede
  `POST /tchekas/compose/voice-preview { mediaId, effect }`: o servidor aplica a mesma cadeia do ffmpeg da montagem
  (`voiceFxGraph`) ao primeiro minuto e devolve um M4A com exatamente as mesmas amostras (os tempos batem 1:1), guardado como
  ficheiro privado da pessoa (apaga-se com os envios por publicar, ao fim de 48 horas); cache por (ficheiro, efeito); 30 por
  hora. A app guarda-o na cache do telemóvel (`txill-vfx-…m4a`) e toca-o no lugar da voz-off ou do som do vídeo. Enquanto
  prepara, o botão do efeito diz «A preparar o efeito…»; sem rede (ou no limite), toca o original e aparece uma nota curta («Sem
  rede: ouve-se sem o efeito.»); tocar outra vez no efeito volta a tentar. Um corte para lá do primeiro minuto ouve-se sem efeito.
  Não há caminho só no aparelho que soe igual sem um módulo nativo novo (o expo-audio não tem filtros; o eco e o estádio precisam
  de atrasos com realimentação e de convolução), por isso o som vem do servidor.
- **Seguinte**: bloqueia a edição, envia cada ficheiro uma vez (um por `media`, com progresso; uma falha de rede tenta outra vez
  sozinha até 4 vezes), pede a montagem e pergunta de 1 em 1 s (em segundo plano não pergunta; ao voltar continua). Cada passo
  fica em `job.json` na pasta do rascunho: ao abrir o rascunho com uma montagem a meio, retoma-se. «Parar» pede confirmação. No
  fim mostra o vídeo montado («Voltar a editar» ou «Seguinte» → o ecrã de publicar, que publica com o `mediaId`, sem enviar).
- **Erros**: 400 com a dica do servidor («Junta mais 2 fotos»…), 409 «Já tens uma tcheka a montar» (se for uma anterior desta
  tcheka, espera por ela e pede a nova), 429, sessão, rede, servidor. Um servidor que ainda não conheça os panos, o enquadramento
  ou o som por clipe responde «Pedido inválido (…)»: o pedido vai outra vez sem eles (`compatRequest`) e diz-se o que ficou de fora.
- **Rascunhos**: `Documentos/estudio-rascunhos/<id>/draft.json` + os ficheiros dos clipes e da voz-off **copiados** (a galeria e
  a câmara podem apagar os delas). «Continuar o rascunho?» aparece ao entrar em Tcheka, como no site.
- **Câmara**: em Tcheka, a câmara nativa junta os clipes (as fotos saem do editor **sem** a assinatura: o vídeo montado leva-a) e
  «Montar» abre o estúdio; a galeria (várias) vai direto ao estúdio. Com 2 ou mais, aparece a «Montagem mágica».

## 3. O que fica aproximado na pré-visualização (o vídeo montado sai completo)

- Filtros nos vídeos que não vão pela Skia (ver 2: ao contrário, iPhone com outra velocidade, ficheiro que não abre): camadas.
- Vídeo da Skia no Android depois de um salto para trás: uns frames a andar depressa até chegar ao frame certo.
- O grão das fotos fica parado (nos vídeos mexe-se a cada frame, como no site).
- Transições: as 11 aproximam-se com opacidade, deslocamento, escala e rotação; as 5 de pano com uma faixa de pano a passar.
- Inverter: salta de frame em frame para trás (8 por segundo), sem som.
- Texto: a quebra das linhas é a do telemóvel; o contorno é uma sombra fina; a ondulação mexe o texto todo (não letra a letra);
  as letras de pano usam a cor forte do pano com um traço por baixo (a faixa de pano vê-se).
- Efeitos de voz: precisam de rede (a primeira vez de cada ficheiro e efeito) e só valem para o primeiro minuto de cada ficheiro.
- Ritmo: o andamento sai da curva do MP3 (os ganhos dos frames); noutros formatos fica 120 BPM. O servidor lê as batidas a sério
  na montagem (`beats: { mode: 'auto' }`), por isso as fotos ao ritmo podem mudar um pouco.
- Montagem mágica: as contas são as do site (`magic.ts`); o que muda é como se chega aos píxeis e ao som (ver 3.1). A música pela
  curva do MP3.
- O medidor de nível do misturador não existe (só no site).

### 3.1 A Montagem mágica no telemóvel

- **Fotos**: a Skia lê a foto e reduz a 32×56 (luz, cor, nitidez, a cara), como no site.
- **Frames dos vídeos**: sem módulos novos. Escolheu-se o `generateThumbnailsAsync` do expo-video e não o `useVideo` da Skia:
  no Android o `seek` da Skia vai para o keyframe anterior (`SEEK_TO_CLOSEST_SYNC`) e descodifica um só frame, por isso devolve
  frames repetidos ou o frame antigo enquanto o descodificador não responde; e só avança a tocar em tempo real (um vídeo de 30 s
  levava 30 s). O expo-video dá o frame exato pedido (`OPTION_CLOSEST` no Android, tolerância zero no iPhone), já rodado, vários
  de uma vez e fora do ecrã. As miniaturas (até 160 px) são uma imagem nativa que só o expo-image desenha: vão para uma grelha
  escondida (`useMagicFrames`), a Skia fotografa-a de uma vez (`makeImageFromView`, como o «Congelar este frame») e reduz cada
  célula a 32×56 duas vezes, numa superfície pequena lida com `readPixels`: cortada ao 9:16 (luz, nitidez, movimento entre frames)
  e inteira (o ponto de interesse). As contas são as mesmas do site (`videoFrame`, `videoSamples`, `videoItemFromFrames`).
- **Quantos frames**: ~2 por segundo, no máximo 40, numa grelha pela ordem do geral para o pormenor (`videoSampleTimes`).
  O tempo é o do site: ~5 s para os vídeos todos, um de cada vez, cada um com a parte dele (entre 0,7 e 3 s). O primeiro lote
  (8 frames) vai sempre; os outros só se couberem no tempo que sobra, por isso com pouco tempo as amostras ficam mais espaçadas.
  O que se mediu fica em cache por ficheiro (mudar de onda e «Outra versão» não voltam a ver nada).
- **«Tem som?»**: o leitor do expo-video diz que pistas de áudio o vídeo tem. No Android é de confiança (o estúdio pergunta-o
  logo a cada vídeo, como o site); no iPhone só um «sim» conta. O servidor diz a última palavra (uma pista só com silêncio conta
  como sem som). Um vídeo sem som não conta para o som obrigatório e o «Som do vídeo» fica desligado.
- **Energia do som**: o telemóvel não descodifica áudio sem um módulo novo. Ao abrir a Montagem mágica, os **vídeos** começam
  logo a ir para o servidor (`magicUploads.ts`; iam na mesma no «Seguinte», que já não os volta a enviar: espera por eles e
  mostra o progresso). Logo que os bytes chegam (antes de convertidos), a fase «A ouvir o som…» pede
  `POST /tchekas/compose/analyze { mediaId }` → `{ hasAudio, energy (4 Hz, 0 a 1), rate, loudestMs, durationMs }`. O servidor
  ouve o original (ou o convertido, se já estiver pronto) com o ffmpeg a 8 kHz e mede a energia (RMS) em blocos de 0,25 s. Só
  vídeos do próprio, públicos, a converter ou prontos; cache em memória por ficheiro, 2 de cada vez (fila de 12, depois 503),
  20 s de prazo, 60 pedidos por minuto. A fase espera no máximo 6 s: sem rede ou sem resposta a tempo, fica só a imagem
  («Sem som a tempo: fica a imagem») e a resposta que chegar depois fica para a montagem seguinte e para o estúdio.
- **Ponto de interesse dos vídeos**: mede-se (a mediana dos frames) e serve para o texto de abertura fugir da cara. Não vai para
  o `fx.focus` dos vídeos (`videoFocus` no `buildMontage`, desligado por omissão): o servidor só enquadra fotos.

## 4. Lista para o teste no emulador

1. **Câmara → estúdio**: Criar → Tcheka → gravar 2 vídeos curtos e tirar 1 foto (o editor abre; «Usar») → «Montar». Deve abrir o
   estúdio a tocar, com os 3 clipes na linha do tempo (miniaturas nos vídeos ao fim de 1 a 2 s) e a foto **sem** o logótipo.
2. **Galeria → estúdio**: Tcheka → botão da galeria → escolher 3 fotos → abre o estúdio. A dica «Escolhe uma música» aparece.
3. **Ecrã de 360 dp** (Pixel 3a / 360×640): o «Seguinte» e o X cabem, a imagem tem pelo menos ~150 px de largura, os 6
   separadores deslizam para o lado, nada fica por baixo da barra de navegação.
4. **Tocar**: tocar na imagem pausa/toca; «0:07 / 0:20» anda; a linha do tempo desliza com o cursor ao meio; um vídeo a 2× toca
   rápido; o som do vídeo ouve-se; a foto aproxima devagar.
5. **Linha do tempo**: arrastar a faixa procura (a imagem acompanha); tocar num clipe mostra as pegas; arrastar a pega encolhe o
   clipe (vibra no limite); «Dividir» com o cursor a meio; «Duplicar»; «Apagar»; manter o dedo num clipe e arrastar muda a ordem;
   dois dedos (ou − e +) aproximam; desfazer e refazer voltam atrás passo a passo.
6. **Som**: Som → Música → escolher uma faixa do catálogo (MP3) → aparece a onda com a janela; arrastar a janela muda o trecho e
   a música recomeça de lá; «Ajustar ao ritmo»; Mistura: calar o vídeo 1, fades, volume da música.
7. **Voz-off**: Som → Voz-off → «Gravar» → 3-2-1 → fala → tocar para parar. Aparece a onda e a faixa «Voz-off» na linha do tempo;
   ao tocar, a música baixa quando se fala. Depois disto o ícone do microfone do sistema deve **apagar-se**.
8. **Efeitos sonoros**: Som → Efeitos → «Pop»: ouve-se logo e aparece um losango na linha do tempo; arrastar o losango muda-o.
9. **Texto**: Texto → «+ Texto» → escrever (a folha sobe com o teclado, o campo continua à vista) → mudar a fonte (as 10 têm de
   ser diferentes) → arrastar o texto na imagem, rodar e escalar com dois dedos (cola às guias amarelas). A faixa do texto
   aparece na linha do tempo e as pontas mudam quando entra e sai.
10. **Stickers**: emoji, Txill, @, local, hora. **Não** há separador GIF (as regras do GIPHY proíbem gravar o GIF no vídeo: `STUDIO_GIFS = false` em `StickerTray.tsx`, o mesmo do site).
11. **Efeitos**: numa foto, os filtros têm a miniatura com a cor certa e a imagem muda logo (com «Vintage» vê-se o grão); num vídeo
    o filtro é o completo, **sem** o aviso «a imagem final…»; transição «Zoom» entre dois clipes → «Ver»; rampa «Herói»; «Inverter»; «Congelar este frame» junta uma foto parada.
12. **Capulana**: Efeitos → Capulana → escolher um pano → «Transição de pano» no clipe 2 → uma faixa de pano passa na junção.
13. **Montagem mágica**: Clipes → «Montagem mágica» → uma onda → «Afinar»: os clipes mudam, o texto de abertura aparece. Com
    vídeos: aparecem «A ver os teus vídeos…» e «A ouvir o som…»; os cortes dos vídeos não começam todos do início. Em modo de
    avião: «Sem som a tempo: fica a imagem». Depois, «Seguinte» não volta a enviar os vídeos (só as fotos).
14. **Seguinte**: com a regra cumprida → «A enviar os clipes… 1 de 3» → «Na fila» / «A montar os clipes…» com a barra a subir →
    o vídeo montado a tocar (com o logótipo, o filtro completo e as transições do site) → «Seguinte» → o ecrã de publicar →
    Publicar (sem voltar a enviar o vídeo). A tcheka aparece no perfil com a música.
15. **Rede**: a meio dos envios, ligar o modo de avião 5 s → «A rede caiu. A tentar outra vez (1 de 4)…» → continua.
16. **Segundo plano**: durante «A montar…», ir ao ecrã inicial 20 s e voltar: a barra continua (ou já está pronto). Fechar a app a
    meio, voltar a abri-la, Tcheka → «Continuar o rascunho?» → «Continuar»: retoma a montagem e mostra o vídeo.
17. **Parar**: «Parar» → confirmação → a edição volta. «Seguinte» outra vez sem mudar nada → aproveita a montagem que já corria.
18. **Rascunho**: editar, sair com o X, entrar outra vez em Tcheka → «Continuar» → tudo como estava (cortes, texto, voz-off).
19. **Erros**: 3 fotos sem música → o botão fica desligado com a dica; 2 montagens seguidas noutro aparelho → «Já tens uma tcheka
    a montar».
20. **Filtro nos vídeos (Skia)**: num vídeo gravado ao alto, «Noite de Maputo»: a imagem fica ao alto (não deitada), com a cor e a
    vinheta iguais às da miniatura e às do vídeo montado; Ajustes → Nitidez 1 e Grão 1: a nitidez vê-se e o grão mexe-se a tocar.
    Tocar: o vídeo anda à velocidade certa (comparar com «0:03 / 0:20»), a 2×, a 0,5× e com a rampa «Herói». Pausar e arrastar a
    linha do tempo para trás e para a frente: a imagem segue (para trás pode andar depressa uns instantes). Na junção de dois
    vídeos cortados a meio, o segundo começa no frame do corte. Num clipe «Inverter» aparece o aviso e o filtro aproximado. Ver no
    logcat (`adb logcat | findstr /i skia`) se aparece «vídeo da Skia: …» (o clipe passou para o leitor antigo).
21. **Memória (Skia)**: um projeto com 8 vídeos; tocar do princípio ao fim 3 vezes; sair e entrar no estúdio 3 vezes: nenhum
    vídeo fica preto ou parado e a app não fecha. No Android Studio → Profiler, a memória nativa não sobe sem parar.
22. **Efeitos de voz**: gravar uma voz-off → Som → Efeitos → «Robô»: o botão diz «A preparar o efeito…» e, uns segundos depois,
    ao tocar ouve-se a voz de robô no sítio certo (a música baixa quando se fala, como antes). Mudar para «Esquilo», «Grave»,
    «Eco», «Rádio», «Estádio»: cada um soa como no vídeo montado. «Efeito no som original» → «Eco»: os vídeos com som ouvem-se
    com eco (um vídeo calado na mistura não). Voltar a «Robô»: é logo (vem da cache). Em modo de avião, um efeito novo: «Sem
    rede: ouve-se sem o efeito.» e ouve-se a voz normal; ligar a rede e tocar outra vez no efeito: prepara. Depois, «Seguinte»
    não volta a enviar a voz-off nem os vídeos que já foram.
23. **iPhone** (se houver): o modo silencioso não cala a pré-visualização; o teclado não tapa o campo do texto.

## 5. Por fazer

- O filtro completo nos clipes ao contrário e, no iPhone, nos clipes com outra velocidade (a Skia não muda a velocidade do
  AVPlayer); o som dos vídeos da Skia sem um segundo descodificador (o leitor do som, expo-video, também descodifica a imagem).
- Os efeitos de voz sem rede (precisava de um módulo de áudio nativo com filtros).
- Enquadrar os vídeos pelo ponto de interesse (o servidor e a pré-visualização só enquadram fotos): ligar `videoFocus`.
- O «tem som?» dos vídeos no iPhone sem a Montagem mágica (o leitor não diz «não»).
- A onda das músicas que não são MP3 (m4a, ogg): pedir ao servidor os picos.
- Cancelar a montagem no servidor (não há `DELETE`): «Parar» só deixa de esperar.
