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
| `lib/studio/nativeLook.ts` | A aproximação dos filtros nos vídeos (pura, testada) |
| `lib/studio/magicAnalyzeNative.ts` | A análise da Montagem mágica no telemóvel |
| `lib/studio/nativeFonts.ts` | As 10 fontes (expo-font) |

Testes: `tests/studioCompose`, `studioComposeJob`, `studioPreviewClock`, `studioNativeDrafts`, `studioMp3`, `studioNativeLook`.

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
- **Filtros**: nas fotos, a matriz de cor verdadeira (`resolveFx` → `ColorMatrix` da Skia) e a vinheta; nos vídeos, uma
  aproximação com camadas (saturação, tinta, brilho e vinheta) e o aviso «a imagem final fica com o filtro completo».
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

- Filtros nos **vídeos** (camadas, não a matriz); nitidez e grão não se veem.
- Transições: as 11 aproximam-se com opacidade, deslocamento, escala e rotação; as 5 de pano com uma faixa de pano a passar.
- Inverter: salta de frame em frame para trás (8 por segundo), sem som.
- Texto: a quebra das linhas é a do telemóvel; o contorno é uma sombra fina; a ondulação mexe o texto todo (não letra a letra);
  as letras de pano usam a cor forte do pano com um traço por baixo (a faixa de pano vê-se).
- Efeitos de voz (robô, eco…) e o efeito no som original: só no vídeo montado.
- Ritmo: o andamento sai da curva do MP3 (os ganhos dos frames); noutros formatos fica 120 BPM. O servidor lê as batidas a sério
  na montagem (`beats: { mode: 'auto' }`), por isso as fotos ao ritmo podem mudar um pouco.
- Montagem mágica: olha para as **fotos** (Skia: luz, cor, nitidez, a cara); os **vídeos** entram com a duração, do início, sem
  «olhar» para os frames; a música pela curva do MP3.
- O medidor de nível do misturador não existe (só no site).

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
10. **Stickers**: emoji, Txill, GIF (a pesquisa do GIPHY), @, local, hora; o GIF mexe-se.
11. **Efeitos**: numa foto, os filtros têm a miniatura com a cor certa e a imagem muda logo; num vídeo, muda aproximado e aparece o
    aviso; transição «Zoom» entre dois clipes → «Ver»; rampa «Herói»; «Inverter»; «Congelar este frame» junta uma foto parada.
12. **Capulana**: Efeitos → Capulana → escolher um pano → «Transição de pano» no clipe 2 → uma faixa de pano passa na junção.
13. **Montagem mágica**: Clipes → «Montagem mágica» → uma onda → «Afinar»: os clipes mudam, o texto de abertura aparece.
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
20. **iPhone** (se houver): o modo silencioso não cala a pré-visualização; o teclado não tapa o campo do texto.

## 5. Por fazer

- Pré-visualização dos efeitos de voz e da matriz de cor nos vídeos (precisava de um módulo de vídeo com shaders, por exemplo o
  `useVideo` da Skia, que não se quis arriscar sem testar).
- «Olhar» para dentro dos vídeos na Montagem mágica (frames em píxeis) e saber se um vídeo tem som antes de montar.
- A onda das músicas que não são MP3 (m4a, ogg): pedir ao servidor os picos.
- Cancelar a montagem no servidor (não há `DELETE`): «Parar» só deixa de esperar.
