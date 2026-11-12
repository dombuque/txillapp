# Compras pela loja (App Store e Google Play)

Pela loja vendem-se **só duas coisas**:

| O quê | Tipo | Produtos (ids por omissão) |
|---|---|---|
| Verificação paga (selo azul, nível `paid`) | Subscrição com renovação automática | `txillapp.verificado.mensal`, `txillapp.verificado.anual` |
| Bombar (destaques dos locais) | Consumível | `txillapp.bombar.1d`, `txillapp.bombar.3d`, `txillapp.bombar.7d` |

Os **Txills não se vendem nas lojas** (continuam só nos pagamentos locais, fora das versões das lojas).

O código está em `apps/api/src/iap/`. A tabela das compras é `payments.iap_purchases`, os acontecimentos (compras,
renovações, reembolsos e avisos das lojas) ficam em `payments.iap_events`, e a verificação paga (quem pode subscrever e
o selo que tinha antes) em `payments.paid_verification` (migração `0127_compras_nas_lojas.sql`).

## Interruptor: `IAP_ENABLED` (desligado por omissão)

Enquanto a app estiver publicada na conta de programador de outra pessoa, as compras ficam **desligadas**:

- `IAP_ENABLED=false` (por omissão), **mesmo com as credenciais todas**:
  - `GET /iap/catalog` devolve `enabled: false` (a app esconde as compras);
  - `POST /iap/apple/verify`, `/iap/google/verify` e `/iap/restore` respondem **503**;
  - criar um rascunho do Bombar com `source: 'iap'` responde **503**;
  - os avisos das lojas (`/iap/apple/notifications` e `/iap/google/rtdn`) continuam a responder 200, mas **só ficam
    registados** (em `payments.iap_events`, com `applied: false`) e não aplicam direitos.
- Para ligar: `IAP_ENABLED=true` e as credenciais da loja. Sem as credenciais de uma loja, essa plataforma continua com
  `enabled: false` e 503.

O teste e2e `apps/api/src/iap/iap.e2e.spec.ts` («desligado (IAP_ENABLED por ligar, mesmo com credenciais)») garante isto.

## Regras

- **Verificação paga**: só pode subscrever quem a equipa aprovou como «elegível para verificação paga». No backoffice,
  em **Pedidos de selo**, o botão **Elegível (paga)** aprova a identidade sem dar o selo (o pedido fica `paid_eligible`).
  - Com uma subscrição ativa: `verified = true` e `verified_tier = 'paid'`. Guarda-se o selo que a conta tinha antes.
  - Quando expira, é reembolsada ou revogada, volta o selo de antes; se antes não era verificada, deixa de ser.
  - Se alguém sem aprovação comprar mesmo assim, a compra fica guardada, a resposta é **403** e o selo aparece logo
    que a equipa aprovar. No Android a compra não é confirmada (acknowledge), por isso a Google devolve o dinheiro
    sozinha passados 3 dias se ninguém aprovar.
- **Bombar**: a app cria primeiro a campanha em rascunho (`state: 'draft'`, «À espera do pagamento»), depois compra o
  produto do pacote. O servidor liga a compra à campanha e ativa-a. Num reembolso, a campanha é suspensa (e a equipa já
  não a pode repor). Parar uma campanha paga na loja não devolve Txills (não os gastou).
  - Os rascunhos por pagar apagam-se passadas **24 horas** e nunca aparecem no feed nem no mapa.
  - Raio fixo por pacote (`IAP_BOOST_RADIUS_KM`, por omissão 3 km nos três): é o raio que o preço base de cada pacote
    cobre hoje (1500, 4000 e 8000 Txills = 150, 400 e 800 MZN, a 0,10 MZN por Txill).

| Produto | Pacote | Dias | Raio | Preço sugerido na loja |
|---|---|---|---|---|
| `txillapp.bombar.1d` | `1d` | 1 | 3 km | ~150 MZN |
| `txillapp.bombar.3d` | `3d` | 3 | 3 km | ~400 MZN |
| `txillapp.bombar.7d` | `7d` | 7 | 3 km | ~800 MZN |

- **Segurança**:
  - Nunca se confia na app. A JWS da Apple é verificada pela cadeia de certificados do cabeçalho (x5c) até à
    **Apple Root CA - G3** (embutida no código, SHA-256 `63:34:3A:BF:…:3E:91:79`), com as extensões da Apple na folha e
    no intermédio, e depois a compra é **lida outra vez na App Store Server API**. O token da Google é lido na
    **Google Play Developer API**.
  - Cada transação conta uma só vez: índices únicos por loja e `transactionId` / `originalTransactionId` (Apple) e
    `purchaseToken` / `orderId` (Google). Uma campanha só é paga por uma compra e uma compra só paga uma campanha.
  - O comprador tem de ser quem tem a sessão. iPhone: `appAccountToken` = o uuid da conta. Android:
    `obfuscatedExternalAccountId` = o uuid da conta. No Android, `obfuscatedExternalProfileId` = o id da campanha do
    Bombar (confirma que a compra é para aquele rascunho).
  - Tudo fica em `audit.audit_log` (ações `iap.*`, `boost.draft_created`, `boost.iap_suspended`, `verification.approve_paid`).

## Contrato da API (prefixo `/api/v1`)

Todas com sessão, menos as duas dos avisos das lojas.

- `GET /iap/catalog?platform=ios|android` →
  `{ enabled, verification: { products: [{ id, period: 'month'|'year' }], eligible, active: { productId, expiresAt, autoRenew } | null }, boost: { products: [{ id, days, radiusKm }] } }`
- `POST /iap/apple/verify` `{ signedTransaction, campaignId? }` → `{ ok: true, entitlement }`
- `POST /iap/google/verify` `{ productId, purchaseToken, campaignId? }` → `{ ok: true, entitlement }`
  (faz o acknowledge da subscrição ou o consume do Bombar)
- `POST /iap/restore` `{ platform, signedTransactions?, purchases?: [{ productId, purchaseToken }] }` →
  `{ ok: true, restored, failed, entitlements }`
- `POST /iap/apple/notifications` `{ signedPayload }`: App Store Server Notifications V2.
- `POST /iap/google/rtdn?token=IAP_GOOGLE_RTDN_TOKEN`: push do Pub/Sub (autenticado pelo segredo no URL).

`entitlement`:
- verificação: `{ kind: 'verification', productId, status, active, expiresAt, autoRenew, verified, tier }`
- Bombar: `{ kind: 'boost', productId, status, campaignId, campaignState }`

`status` da compra: `active`, `expired`, `refunded`, `revoked` ou `consumed` (Bombar já ligado a uma campanha).

Verify é idempotente: a mesma compra pode chegar várias vezes (reenvios no arranque da app) e responde `ok` de novo
sem contar duas vezes.

Erros: 400 compra inválida (assinatura, outra app, produto desconhecido, token que a loja não conhece); 403 compra de
outra conta ou sem aprovação para a verificação paga; 409 compra pendente, já usada noutra campanha, ou rascunho que já
não está à espera; 422 pacote da compra diferente do rascunho; 502 a loja não respondeu; 503 desligado.

Rascunho do Bombar (rota que já existia):
`POST /boosts/venue/:slug` `{ target, package: '1d'|'3d'|'7d', source: 'iap', pack?: '<id do produto>', radiusKm?, idempotencyKey? }`
→ `201 { campaign: { id, state: 'draft', radiusKm, price: 0, payment: 'iap', … }, balance, replayed }`. O `radiusKm`
pedido não conta (é o fixo do pacote); `pack`, se vier, tem de ser o produto desse pacote (senão 422).

Avisos tratados:
- Apple: `SUBSCRIBED`, `DID_RENEW`, `EXPIRED`, `DID_FAIL_TO_RENEW` (com `GRACE_PERIOD` continua ativa até ao fim do
  período de graça), `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE`, `DID_CHANGE_RENEWAL_STATUS`; `CONSUMPTION_REQUEST` e
  `TEST` só ficam registados. Cada `notificationUUID` conta uma vez.
- Google: `subscriptionNotification` (o estado é lido na Google; `SUBSCRIPTION_REVOKED` = revogada) e
  `voidedPurchaseNotification` (reembolso). `oneTimeProductNotification` e `testNotification` só ficam registados. Cada
  `messageId` conta uma vez.

De meia em meia hora (com `IAP_ENABLED=true`), as subscrições ativas que já passaram da data são confirmadas na loja;
se a loja não responder durante 3 dias, dão-se por expiradas. Os rascunhos do Bombar com mais de 24 h apagam-se.

## Variáveis de ambiente (`infra/prod/.env`)

| Variável | O quê |
|---|---|
| `IAP_ENABLED` | `true` liga as compras. **Por omissão `false`.** |
| `IAP_APPLE_ISSUER_ID` | Issuer ID (App Store Connect → Users and Access → Integrations → In-App Purchase) |
| `IAP_APPLE_KEY_ID` | Key ID da chave «In-App Purchase» |
| `IAP_APPLE_KEY_P8` | O ficheiro `SubscriptionKey_XXXX.p8` em base64 (`base64 -w0 SubscriptionKey_XXXX.p8`) ou o PEM numa linha com `\n` |
| `IAP_APPLE_BUNDLE_ID` | O bundle ID da app (`com.txillapp.app`) |
| `IAP_APPLE_ENV` | `Production` (App Store e TestFlight) ou `Sandbox` (só testes) |
| `IAP_APPLE_ACCEPT_SANDBOX` | Em `Production`, aceitar também compras de sandbox (a App Review e o TestFlight compram em sandbox). Por omissão `true`; ficam marcadas «teste» e fora das receitas. |
| `IAP_GOOGLE_SERVICE_ACCOUNT_JSON` | O JSON da conta de serviço em base64 (`base64 -w0 conta.json`) |
| `IAP_GOOGLE_PACKAGE` | O nome do pacote Android (`com.txillapp.app`) |
| `IAP_GOOGLE_RTDN_TOKEN` | Segredo do push do Pub/Sub, 24 caracteres ou mais (`openssl rand -hex 24`) |
| `IAP_PRODUCT_VERIFY_MONTHLY`, `IAP_PRODUCT_VERIFY_YEARLY`, `IAP_PRODUCT_BOOST_1D`, `_3D`, `_7D` | Os ids dos produtos (iguais nas duas lojas) |
| `IAP_BOOST_RADIUS_KM` | O raio fixo de cada pacote, ex.: `1d:3,3d:3,7d:3` |
| `IAP_PRICES`, `IAP_CURRENCY` | Preços de referência em centavos (`id=centavos,…`) para os totais do backoffice. A Apple diz o valor pago e é esse que conta; a Google não diz, e usa-se este. |

`IAP_APPLE_API_ORIGIN`, `IAP_APPLE_ROOT_CA`, `IAP_GOOGLE_API_ORIGIN` e `IAP_GOOGLE_OAUTH_URL` existem **só para os
testes** (a API recusa arrancar em produção com qualquer uma delas).

Depois de mudar o `.env`: `docker compose up -d api` (em `/opt/txillapp/infra/prod`).

## Passo a passo do dono: App Store Connect

1. **Contrato**: Business → Agreements → aceitar o **Paid Apps Agreement** e preencher os dados bancários e fiscais.
   Sem isto as compras não funcionam (nem em sandbox para a App Review).
2. **Subscrições** (App → Monetization → Subscriptions):
   - Criar um **Subscription Group**, por exemplo «Txillapp Verificado».
   - Dentro dele, duas subscrições com renovação automática: `txillapp.verificado.mensal` (1 mês) e
     `txillapp.verificado.anual` (1 ano). Preço, nome e descrição em português, e a imagem para a App Review.
3. **Consumíveis** (App → Monetization → In-App Purchases): `txillapp.bombar.1d`, `txillapp.bombar.3d` e
   `txillapp.bombar.7d`, tipo **Consumable**, com os preços da tabela acima (o escalão mais próximo).
4. **Chave In-App Purchase**: Users and Access → Integrations → **In-App Purchase** → gerar a chave. Guardar o ficheiro
   `.p8` (só se descarrega uma vez), o **Key ID** e o **Issuer ID** → `IAP_APPLE_KEY_P8`, `IAP_APPLE_KEY_ID`,
   `IAP_APPLE_ISSUER_ID`. (Não é a chave de APNs.)
5. **Avisos V2**: App → App Information → **App Store Server Notifications** → Version 2, nos dois campos:
   - Production Server URL: `https://api.txillapp.com/api/v1/iap/apple/notifications`
   - Sandbox Server URL: `https://api.txillapp.com/api/v1/iap/apple/notifications`
   Depois «Request a Test Notification» (fica registada como `notification:TEST` em `payments.iap_events`).
6. **App Review**: na ficha, ligações para os Termos e para a Política de Privacidade; nas notas, explicar que a
   verificação paga só aparece a contas aprovadas e dar uma conta de teste já aprovada como «elegível».

## Passo a passo do dono: Google Play Console

1. **Perfil de pagamentos** ligado à conta de programador (Setup → Payments profile).
2. **Subscrições** (Monetize → Products → Subscriptions): `txillapp.verificado.mensal` e `txillapp.verificado.anual`,
   cada uma com um **plano base** de renovação automática (1 mês / 1 ano) e o preço. Ativar.
3. **Produtos únicos** (Monetize → Products → In-app products): `txillapp.bombar.1d`, `.3d` e `.7d`, com o preço. Ativar.
   (São consumidos pelo servidor depois de verificados.)
4. **Conta de serviço**:
   - No Google Cloud (o projeto ligado à Play Console): ativar a **Google Play Android Developer API**; criar uma
     conta de serviço e uma chave JSON → `IAP_GOOGLE_SERVICE_ACCOUNT_JSON` (em base64).
   - Na Play Console → Users and permissions → convidar o e-mail da conta de serviço com acesso à app e as permissões
     **View financial data, orders, and cancellation survey responses** e **Manage orders and subscriptions**.
   - Pode levar até 24 horas a começar a funcionar.
5. **Avisos em tempo real (RTDN)**:
   - No Google Cloud → Pub/Sub: criar o tópico (ex.: `play-rtdn`) e dar a
     `google-play-developer-notifications@system.gserviceaccount.com` o papel **Pub/Sub Publisher** no tópico.
   - Criar uma subscrição **Push** no tópico com o endpoint
     `https://api.txillapp.com/api/v1/iap/google/rtdn?token=<IAP_GOOGLE_RTDN_TOKEN>` (sem autenticação OIDC: a
     autenticação é o segredo no URL, comparado em tempo constante; guarda-o como um segredo).
   - Na Play Console → Monetization setup → Real-time developer notifications: o nome completo do tópico
     (`projects/<projeto>/topics/play-rtdn`) e «Send test notification» (fica registada como `notification:test`).

## Como testar em sandbox

- Testes automáticos (Apple e Google simuladas, certificados gerados no próprio teste e servidor HTTP falso):
  ```
  docker exec txillapp-postgres-1 psql -U txill -d postgres -c "CREATE DATABASE t_iap1"
  cd apps/api && TEST_DATABASE_URL=postgres://txill:txill_dev@localhost:5433/t_iap1 npx jest --runInBand src/iap
  ```
- **iPhone**: App Store Connect → Users and Access → Sandbox → criar um Sandbox Tester; no iPhone, Definições → App
  Store → Conta de sandbox. Com uma build de TestFlight ou de desenvolvimento, as compras são de sandbox (as
  subscrições renovam de poucos em poucos minutos). Com `IAP_APPLE_ENV=Production` e `IAP_APPLE_ACCEPT_SANDBOX=true`
  são aceites e ficam marcadas «teste» no backoffice. Os reembolsos testam-se no próprio iPhone (Definições → App
  Store → Sandbox → Gerir) ou com «Request a Test Notification».
- **Android**: Play Console → Setup → License testing → juntar as contas de teste; publicar numa faixa de teste interno.
  As compras dessas contas são de teste (as subscrições renovam em minutos) e ficam marcadas «teste». Um reembolso
  faz-se em Order management → Refund (chega como `voidedPurchaseNotification`).
- Em todos os casos é preciso `IAP_ENABLED=true`.

## Backoffice

Finanças → **Compras na loja** (permissão `wallet.view`, só leitura): estado das lojas, contagens por estado,
reembolsos, totais por produto e por mês (só compras reais; as de teste à parte), e a lista com filtros por loja,
estado, produto, ambiente, conta e datas. Rota: `GET /api/v1/admin/fin/store-purchases`.

## Dados pessoais

- Exportação de dados: `storePurchases` (cada compra, com as compras, renovações e reembolsos) e `paidVerification`.
- Apagar a conta: as compras ficam para a contabilidade e para os reembolsos que a loja ainda mande, mas sem o que a
  loja disse da transação (`raw`); a verificação paga sai. A subscrição continua ativa na loja até a pessoa a cancelar
  lá (App Store → Subscrições, ou Google Play → Pagamentos e subscrições).
