# Txillapp na App Store: revisão antes de submeter

Estado a 12 de novembro de 2026, ramo `loja-apple`. Feito a partir das App Store Review Guidelines em vigor, lendo o código de `apps/mobile` e a configuração gerada com `npx expo config --type introspect`. O `npx expo prebuild -p ios` não corre no Windows («Skipping generating the iOS native project files»), e a app nunca foi compilada nem aberta num iPhone.

Substitui as partes técnicas de `docs/APP_STORE.md`, que ainda falava de Capacitor.

**Resposta curta: ainda não podemos submeter.** O que dependia desta equipa e levaria a um chumbo já está corrigido (lista A). Falta o que só o dono pode fazer: a conta Apple, a compilação na nuvem e as notificações no iPhone (lista B). Faltam também as partes das outras equipas: compra dos Txills pela Apple (3.1.1), moderação (1.2) e etiquetas de privacidade.

---

## A. O que chumbaria e já está corrigido

| # | Regra | Problema | O que se fez |
|---|---|---|---|
| A1 | 5.1.1(iv) e HIG | No primeiro arranque, o «Prepara o Txillapp» pedia de seguida notificações, câmara e microfone, fotos e localização, sem contexto. Cada ecrã tinha o botão «Permitir» e a opção «Agora não». A Apple recusa este padrão: o ecrã antes do pedido tem de dizer «Continuar» ou «Seguinte» e não pode ter uma saída antes do pedido do sistema. | No canal `appstore` o arranque mostra só as notificações, com o botão **Continuar** e sem «Agora não». A câmara, as fotos e a localização já eram pedidas no sítio certo (ao abrir a câmara, a galeria, «Perto», enviar localização…), e cada ecrã funciona sem elas. Ficheiros: `src/lib/storeRules.ts` e `src/components/PermissionsOnboarding.tsx`. |
| A2 | 5.1.1(iv) | No iPhone, os ecrãs sem licença da câmara e da galeria tinham os botões «Permitir a câmara» e «Permitir a galeria». | No iPhone passam a dizer **Continuar**. «Abrir definições» fica igual. Ficheiros: `cameraControls.permissionView(…, 'ios')`, `NativeCamera.tsx` e `GalleryPicker.tsx`. |
| A3 | 5.1.1(i) / 2.3 | O `expo-location` entrava sozinho (autolink) com os textos ingleses do Expo: `NSLocationAlways…` «Allow $(PRODUCT_NAME) to access your location», `NSLocationTemporaryUsageDescriptionDictionary` e **`NSMotionUsageDescription`**, que a app não usa. O `expo-secure-store` punha `NSFaceIDUsageDescription` em inglês, e a app também não usa o Face ID. | O `expo-location` está agora nos plugins, com todos os textos em português e `motionUsagePermission: false`: a chave sai e o código de movimento do módulo não é compilado (`EXPO_LOCATION_DISABLE_MOTION`). O `expo-secure-store` tem `faceIDPermission: false`. As chaves Always ficam com um texto honesto («só com a app aberta»), porque o módulo tem código que as referencia (evita o ITMS-90683 no envio), mas a app nunca pede a localização em segundo plano. |
| A4 | 5.1.1(i) | Os textos da câmara, do microfone e das fotos estavam em dois sítios diferentes, e os plugins sobrepunham-se ao `infoPlist`. O texto da câmara não falava da selfie da verificação nem das tchekas. O do microfone não falava dos clipes de música. | Ficou um texto só para cada chave, nos plugins (`expo-camera` e `expo-media-library`), a corresponder ao uso real. |
| A5 | Privacy manifest (obrigatório desde maio de 2024) | Não havia `ios.privacyManifests`. | Foi configurado: `NSPrivacyTracking: false`, sem domínios de rastreio, e as Required Reason APIs com as razões do RN, do Expo e dos módulos: UserDefaults `CA92.1`, FileTimestamp `C617.1`/`0A2A.1`/`3B52.1`, SystemBootTime `35F9.1` (RN timing, boost e o `mach_absolute_time` do WebRTC) e DiskSpace `E174.1`/`85F4.1` (expo-file-system). |
| A6 | 2.5 / ATS | Com o `introspect`, o `NSAppTransportSecurity` aparecia com `NSAllowsArbitraryLoads: true`. Isso vem da base do introspect; o template real do Expo 58 já tinha `false`. | O app.json passa a fixar `NSAllowsArbitraryLoads: false` e `NSAllowsLocalNetworking: true`. Tudo o que a app carrega é HTTPS: a API, os mosaicos, o GIPHY e a música (a API recusa música sem `https`). |
| A7 | 2.1 / 2.2 | O ecrã «Idioma e traduções» mostrava «English: em breve na app» e «Traduzir publicações: em breve», e dizia que a app estava em inglês, o que não é verdade. | Nas lojas (`play` e `appstore`) mostra só o português e diz «A app está em português». Na web fica como estava. |
| A8 | 4.8 | Havia «Entrar com Google». | No iPhone já não aparecia: o botão era só para a web. Agora a regra fica explícita em `googleSignInAllowed()`: nunca no canal `appstore` e só na web. Com email e senha não há login de terceiros, por isso a 4.8 não se aplica. |

Testes: `apps/mobile/tests/appStore.test.mjs` (10 testes). Verificam as regras de cima, o `app.json` (textos, plugins, manifest, ATS, entitlements, ausência de ATT e de contactos), a ausência de SDKs de anúncios ou análise de terceiros, a ausência de `10.0.2.2`, `localhost` e `127.0.0.1` em `src/`, e o ícone a 1024×1024 em RGB sem alfa.

### Verificado e sem mudanças

- **2.3.10 / 2.3.1, Android, APK e beta:** o `AppUpdate.tsx` (APK do txillapp.com/app/beta) sai logo no início quando não é Android, por isso no iPhone nem chega a pedir o `latest.json`. A linha «Instalar a app» e os contactos existem só na web. A Ajuda não fala de Android nem de beta. Não há funcionalidades escondidas ligadas por flag remota no código da app (ver o risco C6 sobre os pagamentos).
- **5.1.1(v), apagar conta:** em Definições → Conta → «Eliminar conta» (também aparece na pesquisa das Definições, por «apagar conta»). Pede o @ e a senha, apaga e termina a sessão. A Ajuda explica onde fica. A página web é da equipa de dados.
- **5.1.1, login obrigatório:** a app só abre o feed com sessão iniciada. Numa rede social em que tudo é conteúdo de contas (feed, mensagens, perfis), a Apple aceita isto. Os termos, a privacidade e a ajuda abrem sem sessão (`_layout.tsx`, `onPublic`). A arquitetura não mudou.
- **5.1.2 / ATT:** não há SDKs de anúncios, análise nem rastreio de terceiros (veja-se o `package.json`). A análise é própria (`lib/analytics`, para o nosso servidor), não segue a pessoa entre apps e pode ser desligada. O «Patrocinado» do Bombar é conteúdo próprio, sem rede de anúncios. **Não é preciso `NSUserTrackingUsageDescription` nem o pedido do ATT.** O SuperTxill da app nativa só mostra sugestões: a conversa com IA (Anthropic) não existe na app, por isso a 5.1.2(i) sobre a IA de terceiros não se aplica aqui.
- **Contactos:** só na web (`settings/conteudo.tsx` mostra a linha só na web). No iPhone não há `NSContactsUsageDescription`, e está certo assim.
- **Bluetooth:** nenhum código usa o CoreBluetooth (procurou-se em todos os módulos nativos). No iOS, os auriculares Bluetooth nas chamadas passam pelo AVAudioSession, que não pede licença. Não se pôs `NSBluetoothAlwaysUsageDescription`, porque seria o texto de uma permissão que nunca se pede.
- **Motion:** não é usado. Tirou-se (A3).
- **Background modes:** `UIBackgroundModes: ['audio']` justifica-se: durante uma chamada (WebRTC) o `lib/calls/webrtc.ts` liga `shouldPlayInBackground: true`, para a chamada continuar quando a pessoa sai da app. A música e os vídeos param em segundo plano. **Não se pôs `voip`**: sem PushKit nem CallKit, a Apple recusaria. As chamadas a tocar chegam por notificação normal com o som `ring.wav`.
- **Entitlements gerados:** `aps-environment` (pelo `expo-notifications`; fica `development` no projeto, e a compilação de distribuição usa `production`) e `com.apple.developer.usernotifications.time-sensitive`. Este último é usado: a API manda as chamadas com `interruption-level: time-sensitive` (`apps/api/src/calls/call-push.ts`).
- **Ícone e splash:** `icon.png` tem 1024×1024 e é RGB, sem canal alfa (aceite). O splash é o logótipo sobre branco (#ffffff), com transparência, e isso é permitido no splash.
- **URLs de desenvolvimento:** o `config.ts` usa `https://txillapp.com` no nativo. O `EXPO_PUBLIC_API_URL` só muda isto se for definido no build, e não há `.env` na app.
- **Texto de teste:** não há placeholders nem «lorem». O componente `Soon` não é usado em lado nenhum.
- **iPad:** `supportsTablet: false`. A Apple pode testar no iPad em modo de compatibilidade de iPhone, e aí a app aparece como num iPhone, ao alto. Não há layouts próprios de iPad (o «modo computador» é só da web).
- **Permissões recusadas:** a câmara mostra «Abrir definições» e «Escolher da galeria». A galeria mostra «Abrir as definições». A localização tem alternativas (pesquisar um sítio, arrastar o mapa). O microfone, sem licença, grava vídeo sem som. Nada bloqueia a app inteira.

---

## B. O que chumbaria (ou impede submeter) e precisa do dono

### B1. Conta Apple Developer e compilação (sem isto não há submissão)
1. Inscrever o Txillapp no Apple Developer Program (99 USD por ano), de preferência como **organização**, o que exige um número D-U-N-S da empresa. Como pessoa individual, o nome da pessoa aparece como vendedor.
2. Em Certificates, Identifiers & Profiles, criar o App ID **`com.txillapp.app`** com as capacidades **Push Notifications**, **Time Sensitive Notifications** e, quando houver (B3), **Sign In with Apple**.
3. Sem Mac, compilar com o **EAS Build**:
   - `npm i -g eas-cli`, depois `eas login` (conta Expo do dono) e `eas build:configure` em `apps/mobile`.
   - No `eas.json`, criar o perfil `production` com `"ios": { "autoIncrement": true }` (o número do build tem de subir em cada envio; o app.json não tem `ios.buildNumber`) e `"env": { "EXPO_PUBLIC_CHANNEL": "appstore" }`. No iPhone o canal por omissão já é `appstore`, mas assim fica explícito.
   - `eas build -p ios --profile production`. O EAS pede a conta Apple e cria o certificado de distribuição e o perfil.
   - `eas submit -p ios` para enviar para o App Store Connect (TestFlight).
4. **Antes de submeter para revisão:** instalar pelo TestFlight num iPhone real e fazer o percurso da secção D. A app nunca correu em iOS. Há módulos nativos pesados (VisionCamera 5 com Nitro, WebRTC, Skia, Reanimated 4), e um erro no arranque é chumbo imediato (2.1).

### B2. Notificações no iPhone não funcionam (as chamadas não tocam com a app fechada)
No iPhone, a app regista o **código APNs** (`getDevicePushTokenAsync`) como `platform: 'ios'`, e a API envia tudo pelo **FCM** (`apps/api/src/push/fcm.ts`). O FCM não aceita códigos APNs: responde com um erro de «registration token», e a API apaga o aparelho. Resultado: no iPhone nunca chega nenhuma notificação, nem as das chamadas. Se o revisor testar chamadas ou mensagens com a app fechada, é um chumbo por 2.1 (funcionalidade que não funciona).

Caminho recomendado, só do lado da API e sem SDK novo na app:
1. Em Keys, no portal da Apple, criar uma chave com **Apple Push Notifications service (APNs)**. Guardar o `.p8`, o **Key ID** e o **Team ID**. Vai para `secrets/` e para o `.env` de produção; nunca para o git.
2. Pôr na API um envio direto para o APNs (HTTP/2 com `node:http2`, JWT ES256 assinado com o `.p8` pelo `jose`, que já é usado, tópico `com.txillapp.app`, `api.push.apple.com`) para os aparelhos com `platform = 'ios'`. Ficam os mesmos campos que já se montam em `buildFcmMessage(…, 'ios')`: `aps.category`, `sound`, `interruption-level`, `apns-priority` e `apns-expiration`.
3. Novas variáveis: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_TOPIC=com.txillapp.app`.

A alternativa é registar a app iOS no Firebase, carregar a chave APNs no Firebase e pôr o `@react-native-firebase/messaging` e o `GoogleService-Info.plist` na app, para ela obter um código FCM. É mais pesada e acrescenta um SDK da Google ao iPhone.

### B3. Iniciar sessão com a Apple (só é preciso se o «Entrar com Google» voltar ao iPhone)
Hoje **não é obrigatório**, porque no iPhone só há email e senha. Ficou preparado:
- **API: já feito.** Há `POST /api/v1/auth/apple` e `/auth/apple/complete` (`apps/api/src/auth/apple.service.ts`), com verificação do identity token pela JWKS da Apple, do emissor, do destinatário e do nonce. O `/auth/config` devolve `appleEnabled`. Fica desligado sem `APPLE_CLIENT_ID`.
- **Cliente: já feito.** `api.appleLogin(identityToken, nonce, fullName)` e `api.appleComplete(…)` em `apps/mobile/src/lib/api.ts`, e o `authConfig()` já lê o `appleEnabled`.
- **Falta (dono):**
  1. Ativar **Sign In with Apple** no App ID `com.txillapp.app`.
  2. Para a web, criar um **Services ID** (ex.: `com.txillapp.web`) com o domínio `txillapp.com` e o URL de retorno, e uma **chave** com Sign in with Apple (`.p8`, Key ID, Team ID).
  3. Na produção: `APPLE_CLIENT_ID=com.txillapp.app,com.txillapp.web`.
- **Falta (código, quando houver conta):**
  1. Em `apps/mobile`, na pasta do repositório principal, porque os node_modules são partilhados: `npx expo install expo-apple-authentication`. No `app.json`, juntar `"usesAppleSignIn": true` em `ios` e o plugin `"expo-apple-authentication"`, que acrescenta o entitlement `com.apple.developer.applesignin`.
  2. Fazer o botão `AppleButton` com o `AppleAuthentication.AppleAuthenticationButton` oficial, só no iOS e com `appleEnabled`. Chama `signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`, depois `api.appleLogin(credential.identityToken, nonce, nome)`. Com `needsUsername`, reaproveita o ecrã `google-username`, a chamar `api.appleComplete`.
  3. **Revogar o token ao apagar a conta** (5.1.1(v), obrigatório para contas com Apple). Ao guardar a conta, a API deve trocar o `authorizationCode` pelo refresh token em `https://appleid.apple.com/auth/token` e, ao eliminar, chamar `https://appleid.apple.com/auth/revoke`, com o `client_secret` assinado com a chave `.p8`. Isto ainda não existe na API.
  4. Só depois disso se pode mostrar o Google no iPhone (com o Google Sign-In nativo), mudando o `googleSignInAllowed()`.

### B4. Decisões do dono para o App Store Connect
- **Encriptação:** o `ITSAppUsesNonExemptEncryption` está `false`. A app usa HTTPS e as chamadas WebRTC (DTLS-SRTP, protocolos normais). Recomenda-se manter «isenta». Se o dono preferir declarar, muda para `true` e responde ao questionário.
- **Classificação etária:** a Geleira tem bebidas alcoólicas, e há conteúdo de utilizadores e mensagens. Com o questionário novo da Apple, o resultado provável é **18+**. O questionário é da equipa de dados e textos das lojas; o dono decide.
- **Países:** confirmar que Moçambique e Portugal estão na lista de distribuição. Na UE, declarar o estatuto de **comerciante (DSA)**, com morada e contacto públicos.

### B5. O que depende das outras equipas (sem isto também chumba)
- **3.1.1:** Txills, Bombar e presentes têm de ser comprados com a compra da Apple (StoreKit), e no iPhone não pode haver M-Pesa, e-Mola, cartão nem ligações para pagar fora. Equipa de pagamentos e UGC.
- **1.2:** filtro, denúncia, bloqueio e compromisso de resposta. Equipa de pagamentos e UGC.
- **5.1.2 e App Privacy:** etiquetas de privacidade, política e página de apagar a conta. Equipa de dados.

---

## C. Riscos menores

1. **C1, nunca testado em iOS.** Ver B1.4. Os pontos mais prováveis de falha são a câmara (VisionCamera 5), as chamadas (WebRTC, o áudio em fundo e o altifalante), os mapas (WebView com Leaflet) e o teclado nas conversas.
2. **C2, textos legais (equipa de dados).** A política diz «se entrares com a Google ou com a Apple», mas no iPhone não há nenhum dos dois. Diz também «Na app Android e no iPhone passam pelo Firebase Cloud Messaging», o que deixa de ser verdade se se seguir o B2. Falar de Android na política é tolerado, mas é melhor dizer «no telemóvel».
3. **C3, Ajuda (equipa de pagamentos).** «Em breve vão pagar vibes», na pergunta dos Txills, é uma funcionalidade anunciada que ainda não existe. Na versão da loja convém tirar.
4. **C4, lembrete das notificações desligadas.** Aparece no máximo uma vez por dia, com pausas de 3, 7, 14 e 30 dias, e leva às Definições do iPhone. É aceite, porque não volta a abrir o pedido do sistema, mas um revisor que recuse as notificações pode vê-lo. Não se mudou.
5. **C5, textos de permissão só em português.** O revisor costuma usar o iPhone em inglês e vê os textos em português. É aceite numa app só em português. Para ajudar, podem juntar-se `locales` com o `InfoPlist.strings` em inglês (os textos já estão no `docs/APP_STORE.md` §5).
6. **C6, flags remotas nos pagamentos.** O `orders.tsx` mostra os métodos que o servidor devolve. Se algum dia o servidor ligar o M-Pesa para o iOS depois da revisão, é uma funcionalidade escondida (2.3.1) e uma violação da 3.1.1. A equipa de pagamentos deve garantir que o servidor nunca devolve métodos externos à app iOS.
7. **C7, número do build.** O app.json não tem `ios.buildNumber` (fica «1»). Usar o `autoIncrement` do EAS (B1.3), ou juntar `ios.buildNumber` ao `scripts/bump-version.mjs`.
8. **C8, «Descarregar os meus dados» no iPhone.** Abre a folha de partilha com o JSON inteiro como texto. Com contas grandes pode ficar lento. Funciona, mas um ficheiro (`expo-file-system` mais `expo-sharing`) seria melhor.
9. **C9, data de nascimento no registo.** Escreve-se à mão («AAAA-MM-DD»). Não é motivo de chumbo, mas um seletor de data seria mais claro para o revisor.
10. **C10, coleta no privacy manifest.** O manifest declara só as Required Reason APIs e que não há rastreio. A lista de `NSPrivacyCollectedDataTypes` não é obrigatória na app (as etiquetas vão no App Store Connect). Se a equipa de dados quiser, junta-se com os mesmos valores das etiquetas.

---

## D. Checklist de submissão

### D1. App Store Connect, a ficha
- [ ] Criar a app: nome **Txillapp**, bundle ID `com.txillapp.app`, SKU `txillapp-ios`, idioma principal **Português (Portugal)**.
- [ ] Subtítulo, descrição e palavras-chave (equipa de textos; rascunho no `docs/APP_STORE.md` §2). A ficha não pode falar de Android, de APK nem de «beta».
- [ ] Categoria: Redes sociais (secundária: Estilo de vida).
- [ ] URL de suporte https://txillapp.com/help, URL de marketing https://txillapp.com e política de privacidade https://txillapp.com/privacy.
- [ ] Capturas de iPhone 6,9" (1320×2868 ou 1290×2796). Não são precisas capturas de iPad (`supportsTablet: false`). Têm de mostrar a app real a funcionar, sem molduras de Android.
- [ ] Ícone: vai no build (o `icon.png` de 1024 sem alfa já está bem).
- [ ] Classificação etária (B4), App Privacy (equipa de dados), encriptação (B4) e direitos de conteúdo (sim, há conteúdo de terceiros: o dos utilizadores).
- [ ] Preço: grátis. Compras dentro da app: os produtos dos Txills (equipa de pagamentos), submetidos **junto com** esta versão.
- [ ] Estatuto DSA (UE) e países.

### D2. Antes de carregar em «Enviar para revisão»
- [ ] Build `production` do EAS com o canal `appstore`, instalado pelo TestFlight num iPhone real.
- [ ] B2 resolvido: uma mensagem e uma chamada com a app fechada tocam no iPhone.
- [ ] Percurso do revisor sem falhas:
  1. abrir a app;
  2. entrar com a conta de demonstração;
  3. aceitar ou recusar as notificações («Continuar»);
  4. ver o feed;
  5. abrir uma publicação e comentar;
  6. publicar uma foto pela câmara: o pedido da câmara aparece aqui, e recusar não pode bloquear;
  7. publicar da galeria;
  8. ver e criar um mimo;
  9. enviar uma mensagem;
  10. fazer uma chamada de voz para a conta B, sair da app e continuar a falar;
  11. «Perto», com e sem localização;
  12. denunciar e bloquear;
  13. Definições → Conta → Eliminar conta (até ao ecrã de confirmação, sem apagar a conta de demonstração);
  14. terminar a sessão.
- [ ] Nenhum «em breve», «teste», «sandbox», APK, Android nem beta visível no iPhone.

### D3. Conta de demonstração para o revisor (descrição; **não criar na produção sem autorização do dono**)
- **Conta A, `revisao.apple`:** email do domínio que o dono controle (ex.: `revisao.apple@txillapp.com`), email **já confirmado** e senha forte só para a revisão. Maior de 18 anos, para a Geleira aparecer inteira como para o público adulto. Foto e bio preenchidas, 3 a 5 publicações (fotos e uma tcheka), um mimo ativo, alguns gostos na Geleira, a seguir 5 contas reais e públicas que tenham conteúdo, e uma conversa já começada com a conta B. Saldo de Txills: o bónus normal, sem pagamentos.
- **Conta B, `revisao.apple2`:** igual, mais simples, para o revisor testar mensagens e chamadas entre dois aparelhos (ou para a nossa equipa atender uma chamada durante a revisão).
- Sem verificação de identidade feita, para o revisor poder ver o ecrã de «Pedir o selo».
- Na ficha: email e senha da conta A no campo de login. A conta B vai nas notas.
- **Depois da aprovação:** mudar as senhas, mas manter as contas para as revisões seguintes.

### D4. Notas para o revisor (App Review Information → Notes; em inglês, como os revisores preferem)

> Txillapp is a social network for Mozambique (Portuguese only): photo and video posts, "mimos" (24-hour stories), "tchekas" (short videos), chat, and voice and video calls.
>
> **Demo accounts:** A = (login fields). B = `revisao.apple2@txillapp.com` / `<password>`. Use B on a second device to test chat and calls.
>
> **Background audio (UIBackgroundModes: audio):** used only to keep an ongoing voice or video call (WebRTC) running when the user leaves the app during the call. To test: open a chat between A and B, tap the phone icon, answer on the other device, then go to the Home Screen. The call audio continues. Music and video stop in the background.
>
> **Time Sensitive notifications:** used only for incoming call alerts.
>
> **Permissions:** notifications are explained once after the first sign-in. Camera, microphone, photos and location are requested only when the user opens the camera, the gallery, voice notes, calls, "Perto" (nearby) or location sharing. Every feature still works, or offers an alternative, if permission is denied.
>
> **User-generated content:** every post, comment, story, message and profile has "Denunciar" (Report) in its ⋯ menu. "Bloquear" (Block) is on the profile. Reports are reviewed by our moderation team, and abusive content is removed under our Terms.
>
> **Account deletion:** Definições (Settings) → Conta (Account) → Eliminar conta (Delete account).
>
> **Alcohol:** the "Geleira" (a profile section of favourite drinks) includes alcoholic drinks and is shown only to users aged 18 or over.
>
> **No tracking:** no third-party analytics or advertising SDKs. First-party usage statistics only, and they can be turned off in Settings.
>
> Contact: suporte@txillapp.com

(Ajustar «Txills» e as compras dentro da app ao que a equipa de pagamentos fechar.)

### D5. Configuração gerada (introspect, para conferir no build)
- **Info.plist (chaves da app):** `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, `NSLocationTemporaryUsageDescriptionDictionary`, todas em português. Também `UIBackgroundModes = [audio]`, `ITSAppUsesNonExemptEncryption = false` e `NSAppTransportSecurity = { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true }`.
- **Já não aparecem:** `NSMotionUsageDescription`, `NSFaceIDUsageDescription`, `NSUserTrackingUsageDescription` e `NSContactsUsageDescription`.
- **Entitlements:** `aps-environment` e `com.apple.developer.usernotifications.time-sensitive`.
- **PrivacyInfo.xcprivacy:** gerado a partir do `ios.privacyManifests` (A5).
- **Confirmar:** `npx expo config --type introspect --json` em `apps/mobile`, ou, num Mac ou no EAS, ver `ios/Txillapp/Info.plist` depois do `npx expo prebuild -p ios`. A pasta `ios/` está no `.gitignore`.
