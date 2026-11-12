# Txillapp no Google Play: dossiê de submissão

Estado a 12 de novembro de 2026, ramo `loja-play`. Feito a partir das políticas do Google Play em vigor nesse dia
(confirmar outra vez na véspera de submeter: as regras mudam várias vezes por ano).

Fora deste documento, porque são de outras equipas:
- pagamentos e UGC (Txills, Bombar, presentes, denúncias, bloqueios);
- dados e privacidade (apagar conta, página web de apagar conta, formulário Data safety, textos da ficha).

## 1. Veredicto

**Com este ramo, a app Android cumpre o que o Play verifica no envio e na revisão das permissões.** Antes dele teria
chumbado. Falta o que só o dono pode fazer: conta, chave de upload, declarações e teste fechado (secção 7).

### O que chumbaria e já está corrigido neste ramo

| # | Problema | Política | Correção |
|---|---|---|---|
| 1 | O aviso «Nova versão do Txillapp» (`AppUpdate`) ia buscar o `latest.json` e abria o APK do site. | Device and Network Abuse: uma app do Play não se pode atualizar por fora do Play. | No canal `play` o `AppUpdate` não faz pedido nenhum nem mostra nada (`canSelfUpdate`, `src/lib/channel.ts` → `selfUpdates`). O beta fica como estava. |
| 2 | `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` e `READ_MEDIA_VISUAL_USER_SELECTED` no manifesto, para a galeria dentro da app. | Photo and Video Permissions (obrigatória desde 28/05/2025): só para apps cujo núcleo é a galeria. Uma rede social não entra. | Bloqueadas em `android.blockedPermissions`. O `expo-media-library` fica com `granularPermissions: []`. No Android, escolher fotos e vídeos passa a usar o **Photo Picker do sistema** (`expo-image-picker`, `src/lib/mediaAccess.ts`). |
| 3 | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` e o serviço `AudioControlsService` do `expo-audio`, que a app nunca arranca. | Foreground service types: cada tipo precisa de uma declaração na Play Console, com vídeo. Uma declaração que não corresponde ao uso é recusada. | `expo-audio` passa a ter `enableBackgroundPlayback: false`. O plugin `withoutUnusedServices` tira os serviços sem uso: `MediaProjectionService` do WebRTC e os dois de localização em segundo plano. **Fica só o serviço das chamadas** (`microphone` e `camera`, secção 2), com declaração. |
| 4 | `SYSTEM_ALERT_WINDOW` (vem do modelo do React Native). | A app não precisa dele. É uma permissão especial e chama a atenção na revisão. | Bloqueada. |
| 5 | O release era assinado com a chave debug e saía em APK. | O Play exige um App Bundle (.aab) assinado com uma chave de upload. Recusa a chave debug. | Plugin `withAndroidUploadSigning`: lê a chave de variáveis de ambiente ou de um `gradle.properties` fora do git. Sem nada disto, usa a chave debug (é o caso do APK beta). Os passos estão na secção 4. |

Também ficaram bloqueadas, por precaução, permissões que nenhum módulo pede hoje mas que um módulo novo poderia trazer
sem darmos por isso: `REQUEST_INSTALL_PACKAGES`, `ACCESS_BACKGROUND_LOCATION`, `USE_FULL_SCREEN_INTENT`,
`QUERY_ALL_PACKAGES`, `READ_CONTACTS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `READ_MEDIA_AUDIO`,
`ACCESS_MEDIA_LOCATION`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `FOREGROUND_SERVICE_LOCATION` e
`FOREGROUND_SERVICE_PHONE_CALL`.

Os testes estão em `apps/mobile/tests/googlePlay.test.mjs` e `apps/mobile/tests/callService.test.mjs`.

## 2. Manifesto final: permissões e justificação

Lista tirada do manifesto juntado pelo Gradle neste ramo (`gradlew :app:processReleaseManifest`, 12/11/2026):
`targetSdkVersion 36`, `minSdkVersion 24`, e um só `foregroundServiceType`: o `microphone|camera` do serviço das
chamadas. Confirma-se outra vez no .aab com `bundletool dump manifest --bundle app-release.aab`.

| Permissão | De onde vem | Para quê | Declaração no Play? |
|---|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE` | app / WebRTC | API, chamadas | não |
| `CAMERA` | app, expo-camera | fotos, vídeos, Zás, videochamadas | não (só Data safety) |
| `RECORD_AUDIO` | app, expo-camera, expo-audio | vídeos, notas de voz, chamadas | não (só Data safety) |
| `MODIFY_AUDIO_SETTINGS` | app, expo-audio, WebRTC | altifalante/auricular nas chamadas | não |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_CAMERA` | `plugins/withCallService.js` | o `CallService`: a chamada continua com a app fora do ecrã | **sim**: «Serviços em primeiro plano» (texto e vídeo mais abaixo) |
| `BLUETOOTH_CONNECT` | app | **só para o som das chamadas** passar para auscultadores/carro Bluetooth (o WebRTC pede-a no Android 12+). Não procura aparelhos: sem `BLUETOOTH_SCAN` e sem localização ligada a Bluetooth. | não |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | app | «Perto», sugerir sítios, partilhar a localização numa conversa. **Só em primeiro plano** (`requestForegroundPermissionsAsync`, `watchPositionAsync`). Sem `ACCESS_BACKGROUND_LOCATION`. | não (Data safety: localização precisa e aproximada) |
| `POST_NOTIFICATIONS` | app, expo-notifications | notificações (Android 13+). O pedido aparece **em contexto**: no passo a passo depois de entrar na conta, com a explicação «Para saberes logo quando a malta te escreve…», e pode ficar para depois. Nunca aparece no arranque sem sessão. | não |
| `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `com.google.android.c2dm.permission.RECEIVE`, `com.txillapp.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | app, expo-notifications, Firebase, AndroidX | notificações e toque de chamada | não |
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | modelo, expo-media-library | **só até ao Android 12**: guardar na galeria. No Android 13+ não existem e guardar não precisa de licença. | não (fora da política de fotos, que é para `READ_MEDIA_*`) |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | expo-secure-store | normais, sem pedido | não |
| permissões de emblemas (Samsung, Huawei, OPPO…) | expo-notifications (ShortcutBadger) | número no ícone | não |
| `BIND_GET_INSTALL_REFERRER_SERVICE` | Play Install Referrer | normal | não |

**Não estão no manifesto, e convém que continuem fora:** `REQUEST_INSTALL_PACKAGES`, `READ_MEDIA_IMAGES`,
`READ_MEDIA_VIDEO`, `ACCESS_BACKGROUND_LOCATION`, `USE_FULL_SCREEN_INTENT`, `SYSTEM_ALERT_WINDOW`,
`QUERY_ALL_PACKAGES`, `READ_CONTACTS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM` e qualquer `FOREGROUND_SERVICE_*` além de `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` e `FOREGROUND_SERVICE_CAMERA`.

### Fotos e vídeos sem `READ_MEDIA_*`

- **Escolher** (publicação, mimo, tcheka, chat, grupos, eventos, verificação): no Android usa o Photo Picker do sistema
  através do `expo-image-picker`. No Android 13+ é o seletor do sistema. Nos Android mais antigos, o Google Play
  services instala a versão retrocompatível ou, sem ela, abre o seletor de documentos. Nenhum dos casos pede licença.
  - A galeria «à Instagram» dentro da app (`GalleryPicker`) fica só no iPhone.
  - No Android, «Nova publicação» começa na câmara do Txillapp, que tem o botão da galeria (abre o seletor do sistema).
  - O passo a passo das permissões já não pede «Fotos e vídeos» no Android.
  - A miniatura da última foto, no botão da câmara, passa a mostrar só o ícone.
- **Guardar na galeria** (mimos, cartões de convite, foto editada, vídeo gravado): `requestPermissionsAsync(true)`, que
  é só escrita. No Android 13+ o `expo-media-library` não pede nada e grava pelo MediaStore. Até ao 12 usa
  `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`).

### Declarações de foreground services (Play Console → Conteúdo da app → Serviços em primeiro plano)

**Um serviço, com dois tipos: `microphone` e `camera`.** É o `CallService` (módulo local `modules/call-service`, em
Kotlin, posto no manifesto pelo `plugins/withCallService.js`). É o **único** foreground service do manifesto final:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA"/>
<service android:name="com.txillapp.callservice.CallService" android:exported="false"
         android:foregroundServiceType="microphone|camera" android:stopWithTask="true"/>
```

**Porquê:** desde o Android 14, uma app que sai do ecrã perde o microfone e a câmara. Sem o serviço, a chamada ficava
muda quando a pessoa ia ao WhatsApp ou bloqueava o ecrã.

**Como funciona:**
- **Arranque.** O serviço arranca quando a chamada começa: ao **ligar**, logo que o microfone abre, e ao **atender**.
  Arranca sempre com a app à vista, depois de um toque em Ligar ou Atender, que é o que o Android 14 exige para estes
  tipos.
- **Tipos.** É `microphone` em todas as chamadas e `microphone|camera` enquanto a câmara está ligada.
- **Paragem.** Pára em todos os fins: desligar, a outra pessoa desligar, sem resposta, falha, sair da conta ou trocar de
  conta (o `signOut`/`switchTo` desliga a chamada), e tirar a app dos recentes (`stopWithTask`).
- **Notificação.** É contínua e de importância baixa, no canal «Chamadas em curso»:
  - mostra «Chamada com <nome>» e o tempo de chamada;
  - tocar nela volta à chamada;
  - a ação «Desligar» desliga.
  Sem a licença de notificações, o serviço arranca na mesma; só não se vê a notificação.
- **A tocar não arranca:** ainda não há microfone aberto e a app pode estar fechada.
- **Plataformas.** Nada disto existe no iPhone nem na web (`src/lib/calls/callService.ts` e `callServiceNative.ts`).
  Num APK antigo, sem o módulo nativo, a chamada segue sem o serviço.

**Porque não `phoneCall`:** esse tipo só é aceite a apps de telefone ou a apps que usam o Telecom
(`ConnectionService` com `MANAGE_OWN_CALLS`). Integrar o Telecom é muito mais trabalho:
- as chamadas passavam a aparecer como chamadas do sistema;
- ficavam ligadas ao Bluetooth do carro e ao ecrã de bloqueio do telefone;
- cada fabricante comporta-se de maneira diferente.
O tipo `microphone`/`camera` está documentado precisamente para «chamadas de voz e vídeo» em apps de comunicação.
`FOREGROUND_SERVICE_PHONE_CALL` fica bloqueado.

**Declaração na Play Console** (Conteúdo da app → Serviços em primeiro plano / Foreground service permissions):

| Campo | Resposta |
|---|---|
| Tipos | **Microphone** e **Camera** |
| Funcionalidade | «Chamadas de voz e vídeo entre utilizadores» (comunicação em tempo real iniciada pelo utilizador) |
| Descrição (PT) | Quando a pessoa liga ou atende uma chamada de voz ou vídeo no Txillapp, um serviço em primeiro plano mantém o microfone (e a câmara, se estiver ligada) a funcionar enquanto ela muda de app ou bloqueia o ecrã. Fica uma notificação contínua «Chamada com <nome>», com Desligar. O serviço pára quando a chamada acaba. |
| Descrição (EN, se pedir) | When the user places or answers a voice or video call, a foreground service keeps the microphone (and the camera, when on) working while they switch apps or lock the screen. An ongoing "Call with <name>" notification with a Hang up action is shown. The service stops as soon as the call ends. |
| Impacto se for adiado/interrompido | A chamada perde o som (e a imagem) ao sair da app: o utilizador é afetado de imediato. |
| Vídeo (link do YouTube, não listado) | 30–60 s gravados no telemóvel: (1) abrir uma conversa e tocar no telefone; (2) a outra pessoa atende; (3) carregar em Início: a notificação «Chamada com …» aparece e a voz continua; (4) tocar na notificação: volta à chamada; (5) ligar a câmara, sair outra vez, a imagem continua; (6) «Desligar» na notificação termina a chamada e a notificação desaparece. |

O APK beta também leva o módulo nativo. Para o fazer, é preciso um `prebuild` antes do `assembleRelease`.

### `USE_FULL_SCREEN_INTENT`

Não é usado nem declarado (está bloqueado). As chamadas chegam como notificação de prioridade alta no canal com o toque
`ring.wav`, e o ecrã da chamada só abre quando se toca nela. Desde o Android 14 o Play só dá esta permissão a apps cujo
núcleo é fazer chamadas ou dar alarmes, e uma rede social com chamadas fica de fora. Se um dia se quiser o ecrã de
chamada por cima do bloqueio:
- tirar `USE_FULL_SCREEN_INTENT` de `blockedPermissions`;
- preencher a declaração «Full-screen intent» na Play Console;
- contar com a possibilidade de recusa. A alternativa sem declaração é a notificação `CallStyle`.

## 3. Requisitos técnicos

| Requisito | Estado |
|---|---|
| Target API | **36 (Android 16)**: é o default do Expo 58 (`targetSdk 36`, `compileSdk 37`, `minSdk 24`). Para apps novas e atualizações, o Play exige 36 desde 31/08/2026. |
| 64 bits | `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`. O .aab leva `arm64-v8a` e `x86_64`. |
| Páginas de 16 KB (obrigatório para target 35+ desde 01/11/2025) | Verificado no APK de release de 12/11: as 72 bibliotecas `.so` de `arm64-v8a` e de `x86_64` têm os segmentos LOAD alinhados a `0x4000`, e o `zipalign -c -P 16` passa. Repetir em cada atualização das bibliotecas nativas (WebRTC, VisionCamera, Skia, Nitro). |
| Formato | App Bundle (.aab), com o Play App Signing. |
| Pacote | `com.txillapp.app`. É definitivo depois do primeiro envio. |
| Nome | `Txillapp` (`expo.name`). |
| `versionName` | `expo.version` (hoje `1.28.5`). |
| `versionCode` | `expo.android.versionCode` (hoje `62`). **Tem de subir em cada .aab enviado**, também nos testes. O beta e o Play partilham o número: se um APK beta usar o 63, o próximo .aab tem de ser 64 ou mais. |
| Ícone adaptativo | `android-icon-foreground.png`, `android-icon-background.png` e `android-icon-monochrome.png` (ícone temático do Android 13). Na ficha da loja é preciso, à parte, um ícone 512×512 PNG de 32 bits: gerar a partir de `store/icon-1024.png`. |
| Endereços | A app aponta para `https://txillapp.com` (`src/lib/config.ts`). Não há `10.0.2.2`, `localhost` nem `http://` no código. Não há `.env` em `apps/mobile`: confirmar que continua assim na máquina do build, porque um `EXPO_PUBLIC_API_URL` ficava gravado no .aab. |

## 4. Chave de upload e `bundleRelease`

O Play guarda a chave de assinatura da app (Play App Signing). Nós assinamos com uma **chave de upload**, que se pode
substituir se se perder (pedido ao suporte do Play). Mesmo assim, guarda duas cópias, fora do repositório e fora da
pasta do projeto.

### 4.1 Criar a chave (uma vez, no computador do dono)

PowerShell:

```powershell
$jdk = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot'
New-Item -ItemType Directory -Force "$env:USERPROFILE\txillapp-chaves" | Out-Null
& "$jdk\bin\keytool.exe" -genkeypair -v -storetype PKCS12 `
  -keystore "$env:USERPROFILE\txillapp-chaves\txillapp-upload.jks" `
  -alias txillapp-upload -keyalg RSA -keysize 2048 -validity 10000
```

- O `keytool` pede uma senha e os dados do certificado (nome, organização, país `MZ`).
- Em PKCS12, a senha da keystore e a da chave são a mesma.
- Guarda a senha num gestor de senhas. **Nunca** a ponhas no repositório, num `.env` da app nem em `secrets/` do servidor.
- O `.gitignore` de `apps/mobile` já ignora `*.jks`, `*.keystore` e `keystore.properties`.

Para ver a impressão digital (é pedida no registo do pacote, ver secção 8):

```powershell
& "$jdk\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\txillapp-chaves\txillapp-upload.jks" -alias txillapp-upload
```

### 4.2 Dizer ao build onde está a chave

O plugin `apps/mobile/plugins/withAndroidUploadSigning.js` acrescenta ao `android/app/build.gradle` gerado um
`signingConfigs.release`. Lê estas quatro variáveis, primeiro do ambiente e depois das propriedades do Gradle:

| Nome | Exemplo |
|---|---|
| `TXILLAPP_UPLOAD_STORE_FILE` | `C:/Users/<tu>/txillapp-chaves/txillapp-upload.jks` (caminho absoluto, com `/`) |
| `TXILLAPP_UPLOAD_STORE_PASSWORD` | a senha |
| `TXILLAPP_UPLOAD_KEY_ALIAS` | `txillapp-upload` |
| `TXILLAPP_UPLOAD_KEY_PASSWORD` | a senha (a mesma, em PKCS12) |

Se faltar alguma, o release é assinado com a chave debug e o Gradle avisa:
`txillapp: sem chave de upload (TXILLAPP_UPLOAD_*)…`. **Um .aab assinado assim é recusado pelo Play.**

**Recomendado: variáveis só na sessão do build do Play.** Assim o APK beta continua com a chave debug e os telemóveis
que já o têm conseguem atualizar. Se as puseres em `%USERPROFILE%\.gradle\gradle.properties`, passam a valer para todos
os builds de release, incluindo o APK beta. Um APK beta assinado com outra chave já não instala por cima do antigo.

### 4.3 Gerar o .aab

PowerShell, em `apps/mobile`:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot'
$env:EXPO_PUBLIC_CHANNEL = 'play'          # sem isto o .aab traz o aviso de atualização do beta
$env:TXILLAPP_UPLOAD_STORE_FILE = "$env:USERPROFILE/txillapp-chaves/txillapp-upload.jks"
$env:TXILLAPP_UPLOAD_KEY_ALIAS = 'txillapp-upload'
$env:TXILLAPP_UPLOAD_STORE_PASSWORD = Read-Host 'Senha da chave de upload'
$env:TXILLAPP_UPLOAD_KEY_PASSWORD = $env:TXILLAPP_UPLOAD_STORE_PASSWORD

# 1. versionCode: sobe expo.android.versionCode no app.json (e expo.version, se for versão nova)
npx expo prebuild -p android --clean --no-install
cd android
.\gradlew.bat clean bundleRelease
# Resultado: android\app\build\outputs\bundle\release\app-release.aab
```

Verificar antes de enviar:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -printcert -jarfile app\build\outputs\bundle\release\app-release.aab
# Tem de mostrar o certificado da chave de upload (CN que escolheste), NÃO "CN=Android Debug".
```

Depois de instalar pelo teste interno, abre **Definições → Ajuda → Versão**. Tem de dizer `versão 1.x.y · Google Play`.
Se disser `· beta`, o `EXPO_PUBLIC_CHANNEL=play` não entrou no JS. Nesse caso, apaga a cache do Metro
(`npx expo start --clear` uma vez, ou apaga `%TEMP%\metro-*`) e repete o `bundleRelease`.

**Prebuild num worktree (`C:/dombuque/txill-wt/...`) com o `node_modules` ligado por junção.** Aí o
`expo prebuild` encrava em «Running prebuild», com o CPU a 100 %. Não é dos plugins.
- **Causa:** o `withPackageRefactor` do Expo procura `…\debug\java\**\*.@(java|kt)` com barras invertidas. O
  tinyglobby lê-as como escapes e percorre a pasta atual inteira. A junção do `node_modules` deixa-o às voltas sem fim.
- **No repositório principal** o `node_modules` é uma pasta normal e não acontece.
- **Contorno:** correr o CLI a partir de uma pasta vazia, sem junções, com uma cópia de `assets/` e do
  `google-services.json`. Estes são lidos a partir da pasta atual.

```bash
mkdir -p /tmp/pb && cd /tmp/pb && cp -r <worktree>/apps/mobile/assets <worktree>/apps/mobile/google-services.json .
CI=1 node <worktree>/apps/mobile/node_modules/expo/bin/cli prebuild <worktree>/apps/mobile -p android --no-install
```

O APK beta continua a fazer-se como até aqui, **sem** as variáveis `TXILLAPP_UPLOAD_*` e sem `EXPO_PUBLIC_CHANNEL`
(ou com `beta`): `npx expo prebuild -p android --no-install`, depois `.\gradlew.bat assembleRelease`.

## 5. Classificação de conteúdo (questionário IARC)

Na Play Console: Conteúdo da app → Classificação de conteúdo. Respostas, a partir do que a app faz hoje:

| Pergunta | Resposta | Porquê |
|---|---|---|
| Categoria | **Redes sociais / comunicação** («Social networking, forums, blogs and UGC sharing») | |
| Violência, sangue, terror | Não | A app não tem conteúdo próprio deste tipo. O conteúdo dos utilizadores é moderado (ver a outra equipa). |
| Sexualidade, nudez | Não | Proibida nos Termos. As fotos passam por uma pontuação de nudez (`nsfw_score`) e a denúncia «nudez» existe. |
| Linguagem ofensiva | Não (no conteúdo da app) | |
| Drogas | Não | |
| **Álcool** | **Sim: referências** | Na Geleira, cada pessoa lista as bebidas de que gosta (Laurentina, 2M, vinho…). Não há venda, não há incentivo ao consumo, e **menores de 18 não veem nem adicionam bebidas alcoólicas** (`apps/api/src/geleira/geleira.service.ts`, `ADULT = 18`, validado no servidor). |
| Tabaco | Não | |
| Jogo a dinheiro / casino simulado | Não | |
| Os utilizadores podem interagir ou trocar conteúdo? | **Sim** | Chat, comentários, publicações, chamadas. |
| Partilha de localização com outros utilizadores? | **Sim** | Partilhar a localização numa conversa, e o mapa «Perto» (**só adultos**: `nearby.service.ts`, `ADULT_SQL`). |
| Partilha de informação pessoal? | Sim | Perfil público, conversas. |
| Compras digitais? | **Sim** | Txills (as respostas e as regras são da equipa de pagamentos). |
| A app é um navegador ou motor de pesquisa? | Não | |
| A app é sobretudo notícias/educação? | Não | |

Classificação esperada: **PEGI 12 / USK 12 / ESRB Teen**, com os descritores «Utilizadores interagem», «Partilha de
localização» e «Compras na app». Se o IARC der 16+ por causa do álcool, aceita. A idade mínima da conta (15) continua a
valer, porque a classificação é uma indicação para os pais e não bloqueia a instalação.

### Público-alvo (Conteúdo da app → Público-alvo e conteúdo)

- Idade mínima da conta: **15 anos**, validada no servidor (`packages/shared` → `MIN_AGE = 15`, data de nascimento no
  registo).
- Escalões a marcar: **13–15** (por causa das pessoas de 15 anos), **16–17** e **18+**. **Não** marcar nenhum escalão
  abaixo dos 13. Com um desses escalões, entravam a política Famílias e os SDK certificados para crianças.
- «A app pode atrair crianças?» → **Não**: a ficha, o ícone e os textos não são infantis.
- Restrições a menores que já existem e se podem citar ao revisor:
  - bebidas alcoólicas na Geleira só a partir dos 18;
  - aparecer no mapa «Perto» e ver quem está à volta só a partir dos 18;
  - denúncia com o motivo «menor» (`minor`) na moderação.
- A UGC (denúncias, bloqueios, filtros) e o Bombar (publicidade paga) são da outra equipa. A resposta a «A app tem
  anúncios?» depende de o Bombar contar como anúncio. Decide-o a equipa de pagamentos/UGC.

## 6. Pre-launch report e conta de demonstração

### Arranque sem sessão (pre-launch report)

O robô do Play instala a app em vários aparelhos e navega sem sessão. Verificado no código:
- **Sem sessão**, o `Gate` (`src/app/_layout.tsx`) manda para `/login`. Daí chega-se a registar, recuperar a senha,
  Termos, Privacidade e Ajuda.
- As chamadas (`CallOverlay`), os lembretes de push e o passo a passo das permissões só existem com sessão. O robô não
  vê pedidos de permissão no arranque.
- Sem rede, aparece o ecrã «Sem ligação» com «Tentar outra vez», e a app não rebenta.
- Erros de ecrã caem no `ErrorBoundary` («Ups, algo correu mal»).
- O módulo nativo do WebRTC só carrega quando há uma chamada.
- O `google-services.json` está no repositório (FCM). O release passa pelo R8 com as regras de
  `plugins/withProguardRules.js`.

Não corri a app num aparelho (sem emulador nesta tarefa). Os crashes que só aparecem num aparelho real ficam para o
teste interno e para o pre-launch report (secção 7, passo 6).

Para o robô também testar com sessão: Testes → Relatório de pré-lançamento → Definições → «Credenciais de teste».
Põe aí a conta de demonstração. O ecrã de login tem os campos de email/utilizador e senha com rótulos.

### Conta de demonstração para o revisor (Conteúdo da app → Acesso à app)

Escolhe «Todas ou algumas funcionalidades estão restritas» e dá uma conta assim (cria-a tu, na produção):

- **Utilizador:** `revisao.play` (ou parecido), email de uma caixa nossa, por exemplo `play-review@txillapp.com`.
  Senha forte, só para isto, guardada no gestor de senhas.
- **Idade: adulta** (data de nascimento com mais de 18 anos), para o revisor ver a Geleira completa e o «Perto».
- **Conta já confirmada** (email verificado). **Sem** verificação em dois passos nem código por SMS: o revisor não
  consegue recebê-los.
- **Com conteúdo:** foto de perfil, 3–5 publicações, um mimo, alguns itens na Geleira. Deve seguir e ser seguida por 2–3
  contas de teste com publicações, para o feed, as mensagens e as notificações não aparecerem vazios. Deve ter uma
  conversa com mensagens e, se der, um grupo.
- **Txills:** saldo pequeno ou nenhum, conforme a equipa de pagamentos decidir para a revisão.
- **Instruções para o revisor** (em inglês, no campo da Play Console):
  - *Log in with the username and password below.*
  - *Calls: open a conversation with @<conta-teste> and tap the phone icon.*
  - *Nearby map and alcoholic items in "Geleira" are restricted to users aged 18+.*
- Não pode expirar, não pode ser apagada pela limpeza de contas inativas, e a senha não pode mudar sem atualizar a
  Play Console.

## 7. O que precisa do dono (passos exatos)

1. **Conta de programador do Google Play** (play.google.com/console): 25 USD, uma vez.
   - Escolher entre conta **pessoal** e conta **de organização**. A de organização precisa de um número D-U-N-S da
     empresa e **não** tem o teste fechado obrigatório do passo 5.
   - Verificar a identidade e o telefone de contacto, e confirmar o acesso a um aparelho Android físico com a app da
     Play Console (a Google pede isto às contas novas).
2. **Criar a app**: nome «Txillapp», idioma predefinido Português, tipo App, gratuita (com compras na app, se a equipa de
   pagamentos o confirmar).
3. **Criar a chave de upload** (secção 4.1) e guardá-la em dois sítios. No primeiro envio, aceitar o **Play App Signing**
   (a Google gera a chave da app).
4. **Gerar o .aab** com `EXPO_PUBLIC_CHANNEL=play` e a chave de upload (secção 4.3). Enviar primeiro para **Teste
   interno** e confirmar no telemóvel que a versão diz `· Google Play`.
5. **Teste fechado** (só para contas **pessoais** criadas depois de 13/11/2023; regra confirmada a 12/11/2026):
   - **pelo menos 12 testers** inscritos no teste fechado;
   - **14 dias seguidos** inscritos (quem sai e volta recomeça a contagem);
   - só depois aparece «Pedir acesso à produção» no Painel, com um questionário sobre o teste;
   - na prática:
     - criar uma faixa «Teste fechado» com uma lista de emails (Contas Google) de **15–20 pessoas**, com folga;
     - mandar-lhes o link de inscrição;
     - pedir que usem a app de verdade durante as duas semanas e que não saiam do teste;
     - responder ao questionário com o que se aprendeu e o que se corrigiu.
6. **Ver o relatório de pré-lançamento** do teste interno/fechado (Testes → Relatório de pré-lançamento) e corrigir os
   crashes que aparecerem.
7. **Conteúdo da app**, todas as secções:
   - Acesso à app (conta de demonstração, secção 6);
   - Anúncios (decisão da equipa UGC/pagamentos);
   - Classificação de conteúdo (secção 5);
   - Público-alvo (secção 5);
   - Segurança dos dados e Eliminação da conta (equipa de dados);
   - Serviços em primeiro plano: microfone e câmara, para as chamadas (declaração e vídeo na secção 2);
   - Intenção de ecrã inteiro: não usada;
   - Permissões de fotos e vídeos: não usadas (se a Play Console perguntar, responder que a app usa o Photo Picker);
   - App governamental: não; Funcionalidades financeiras: confirmar com a equipa de pagamentos; Saúde: não; Notícias: não.
8. **Ficha da loja**:
   - ícone 512×512;
   - gráfico de destaque 1024×500;
   - 2–8 capturas de telemóvel;
   - descrição curta (80 caracteres) e completa;
   - email de contacto, política de privacidade `https://txillapp.com/privacy` e site.
   Os textos são da equipa de dados/textos.
9. **Países**: Moçambique (e os outros que se queira).

## 8. Riscos menores

- **Beta e Play com o mesmo pacote.** O APK beta (chave debug) e a app do Play (chave da Google) têm o mesmo
  `com.txillapp.app` e assinaturas diferentes. Quem tem o beta tem de o **desinstalar** antes de instalar pelo Play, e
  perde a sessão e os rascunhos locais. Há duas opções:
  - avisar no site e no último `latest.json` do beta: «agora estamos no Play»;
  - ou passar o beta para outro pacote (`com.txillapp.app.beta`).
- **Verificação de programadores Android.** Desde 30/09/2026 está em vigor no Brasil, Indonésia, Singapura e Tailândia,
  e o alargamento a todo o mundo está anunciado para 2027. Quando chegar a Moçambique, o APK beta instalado por fora tem
  de estar registado com uma chave verificada. A chave debug não serve. Planear o fim do APK beta, ou assiná-lo com uma
  chave própria, antes disso.
- **Chamadas em segundo plano: resolvido** com o `CallService` (secção 2). Falta testar num telemóvel real com Android
  14+:
  - sair da app a meio de uma chamada de voz e de uma de vídeo;
  - «Desligar» na notificação;
  - tirar a app dos recentes;
  - uma conta sem licença de notificações.
  Se o Play recusar a declaração, a alternativa é o Telecom (`phoneCall` + `ConnectionService`), com bastante mais
  trabalho.
- **Galeria no Android.** A galeria «à Instagram» passa a ser o seletor do sistema. A mudança é visível para os
  utilizadores Android do beta, com o mesmo resultado (escolher várias fotos, vídeos até 60 s).
- **`BLUETOOTH_CONNECT`** é um pedido em tempo de execução no Android 12+. Se o revisor perguntar, a resposta é: áudio
  das chamadas em auscultadores Bluetooth.
- **`EXPO_PUBLIC_CHANNEL` esquecido.** Um .aab sem ele volta a trazer o aviso de atualização do beta, e esse chumba.
  Confirmar sempre em Definições → Ajuda → Versão (secção 4.3).
- **`versionCode` repetido.** O Play recusa um .aab com um `versionCode` já usado, também nas faixas de teste. O beta e o
  Play partilham o contador.
- **Módulos novos podem trazer permissões ou serviços.** O `blockedPermissions` apanha as permissões conhecidas, mas não
  os serviços. Depois de cada atualização do Expo ou de módulos nativos, ver o manifesto do .aab
  (`bundletool dump manifest`) contra a secção 2, e repetir a verificação dos 16 KB.
- **Políticas que mudam.** O target API sobe todos os anos (o próximo prazo deve ser em agosto de 2027, para API 37).
  Confirmar em developer.android.com/google/play/requirements/target-sdk.
- **`docs/ANDROID.md`** ainda fala do projeto Capacitor antigo (`apps/web/android`). A app Android de hoje é a Expo
  (`apps/mobile`). Este documento substitui a secção «Versão para a Google Play» de lá.

## 9. Checklist de submissão

- [ ] Conta do Play Console criada e verificada (pessoal ou de organização).
- [ ] Chave de upload criada (secção 4.1), com duas cópias e a senha no gestor.
- [ ] `versionCode` acima do último beta/Play e `expo.version` certo.
- [ ] `.aab` feito com `EXPO_PUBLIC_CHANNEL=play` e a chave de upload; `keytool -printcert` **sem** «Android Debug».
- [ ] No telemóvel (teste interno): Definições → Ajuda → Versão diz `· Google Play`, sem aviso «Nova versão».
- [ ] Manifesto do .aab igual à secção 2: sem `READ_MEDIA_*`, `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`,
      `ACCESS_BACKGROUND_LOCATION`, `USE_FULL_SCREEN_INTENT`; o único `<service foregroundServiceType>` é o
      `CallService` (`microphone|camera`).
- [ ] Num Android 14+: sair da app a meio de uma chamada mantém a voz (e a imagem); a notificação «Chamada com …»
      aparece, volta à chamada ao tocar e desaparece no fim.
- [ ] No Android: escolher fotos abre o seletor do sistema; guardar um mimo na galeria funciona (Android 13+ e um ≤12).
- [ ] Notificações pedidas no passo a passo depois de entrar, não no arranque.
- [ ] Relatório de pré-lançamento sem crashes.
- [ ] Teste fechado: 12+ testers inscritos durante 14 dias seguidos (conta pessoal) e pedido de acesso à produção.
- [ ] Conteúdo da app:
  - [ ] Acesso à app (conta de demonstração e instruções);
  - [ ] Classificação IARC;
  - [ ] Público-alvo (13–15, 16–17, 18+);
  - [ ] Anúncios;
  - [ ] Data safety;
  - [ ] Eliminação da conta (URL);
  - [ ] Serviços em primeiro plano: microfone e câmara (texto e vídeo da secção 2);
  - [ ] Funcionalidades financeiras.
- [ ] Ficha da loja: ícone 512, gráfico 1024×500, capturas, textos, contacto, privacidade.
- [ ] Países e preço (gratuita).
