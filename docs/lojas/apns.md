# Notificações no iPhone (APNs)

A app no iPhone regista o código APNs do aparelho (`getDevicePushTokenAsync` do expo-notifications, 64 caracteres
hexadecimais, com `platform: 'ios'`). A API envia esse código **diretamente para a Apple** (HTTP/2, `node:http2`,
autenticação por token com a chave `.p8`). O Android continua no FCM e o browser no Web Push.

Antes, tudo ia para o FCM. O FCM não aceita códigos APNs e a API apagava o aparelho. Por isso, nenhuma mensagem nem chamada
tocava com a app fechada. Os iPhones apagados voltam a registar-se sozinhos: a app regista o código sempre que abre com
sessão iniciada e sempre que volta a ficar à vista (no máximo de 10 em 10 minutos).

Código: `apps/api/src/push/apns.ts` (envio) e `apps/api/src/push/push.service.ts` (encaminhamento).

## 1. Criar a chave APNs (Apple Developer)

1. Entra em <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles** → **Keys** → botão **+**.
2. Nome: `Txillapp APNs`. Marca **Apple Push Notifications service (APNs)**. Em **Configure**, escolhe
   **Sandbox & Production** (se a opção aparecer). → **Continue** → **Register**.
3. **Download** do ficheiro `AuthKey_XXXXXXXXXX.p8`. **A Apple só o deixa descarregar uma vez.** Guarda-o num sítio
   seguro (gestor de senhas), nunca no git.
4. Toma nota de:
   - **Key ID**: os 10 caracteres do nome do ficheiro e da página da chave → `APNS_KEY_ID`;
   - **Team ID**: no canto superior direito da conta, ou em **Membership details** → `APNS_TEAM_ID`.
5. Confirma em **Identifiers** → `com.txillapp.app` que **Push Notifications** está ligado (a mesma chave serve para
   todas as apps da equipa).

Uma conta pode ter, no máximo, duas chaves APNs. Se a chave se perder, revoga-a e cria outra.

## 2. Pôr as variáveis no servidor

As variáveis da API vêm do `.env` em `/opt/txillapp/infra/prod/` (`env_file: .env` no serviço `api` do
`docker-compose.yml`), como as do VAPID e do FCM. O `docker compose` não lê valores com várias linhas no `.env`. Por isso,
a chave vai numa linha, em base64.

No teu computador:

```sh
base64 -w0 AuthKey_XXXXXXXXXX.p8 ; echo        # Linux / Git Bash
base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'   # macOS
```

No servidor (`ssh txillapp`), acrescenta ao `/opt/txillapp/infra/prod/.env`:

```env
APNS_KEY_P8=<a linha em base64>
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=YYYYYYYYYY
APNS_BUNDLE_ID=com.txillapp.app
APNS_PRODUCTION=true
```

- `APNS_PRODUCTION=true`: TestFlight e App Store (`api.push.apple.com`). Põe `false` só se fores testar com um build de
  desenvolvimento instalado pelo Xcode ou com um perfil de desenvolvimento (`api.sandbox.push.apple.com`). Se os ambientes
  não baterem certo, a Apple responde `BadDeviceToken` e a API apaga o aparelho, que se volta a registar ao abrir a app.
- `APNS_KEY_P8` também aceita o PEM numa linha com `\n` no lugar das quebras de linha.
- Em vez de `APNS_KEY_P8` podes usar `APNS_KEY_PATH=/caminho/AuthKey.p8`. O ficheiro tem de estar dentro do contentor,
  o que obriga a montar um volume no `docker-compose.yml`. A forma em base64 evita isso.
- `APNS_BUNDLE_ID` é `com.txillapp.app` por omissão. Pode ficar de fora.

Para a API ler as variáveis novas, segue o deploy habitual (`docker compose up -d --build api`). Sem a chave, o
`APNS_KEY_ID` e o `APNS_TEAM_ID`, o envio para o iPhone fica desligado. A API escreve um aviso uma vez ao arrancar
(`APNs desligado (...)`) e não apaga os iPhones registados: ficam à espera da chave. A chave e o JWT nunca aparecem nos
registos.

## 3. Testar

1. Depois do deploy, vê os registos da API: `docker compose logs api | grep -i apns`. Não deve aparecer
   `APNs desligado`.
2. No iPhone, com um build do TestFlight: abre a app com sessão iniciada e dá licença às notificações (a app regista o
   código ao abrir).
3. **Definições → Notificações → Enviar notificação de teste** (`POST /api/v1/push/test`). A notificação deve chegar
   com a app em segundo plano e também com a app fechada.
4. Testa uma mensagem e uma chamada com a app fechada. A chamada toca com `ring.wav`, mostra os botões Atender e Recusar
   e passa o modo Foco (time-sensitive). As notificações de cada conversa ficam agrupadas.
5. Se não chegar nada, procura nos registos:
   - `APNs 403 InvalidProviderToken`: o Key ID, o Team ID ou a chave estão errados;
   - `APNs 400 BadDeviceToken`: o `APNS_PRODUCTION` não corresponde ao build (TestFlight → `true`);
   - `APNs 400 DeviceTokenNotForTopic`: o `APNS_BUNDLE_ID` está errado;
   - `APNs 410`: a app foi desinstalada; o aparelho foi apagado.

Para ver os aparelhos registados (no servidor):

```sh
docker compose exec postgres psql -U txill -d txillapp -c "SELECT platform, count(*) FROM social.push_devices GROUP BY 1"
```

## O que vai para a Apple

| Cabeçalho / campo | Valor |
|---|---|
| `apns-topic` | `APNS_BUNDLE_ID` |
| `apns-push-type` | `alert` (não há envios silenciosos para a app nativa) |
| `apns-priority` | `10` em mensagens, chamadas e teste; `5` no resto (seguidores, brindes…) |
| `apns-collapse-id` | a etiqueta (`tag`): várias mensagens da mesma pessoa substituem-se, e a chamada perdida substitui a chamada |
| `apns-expiration` | quando o aviso tem validade (chamadas: o tempo de toque) |
| `aps.alert` | título e texto (nunca o conteúdo da mensagem) |
| `aps.sound` | `ring.wav` nas chamadas; `default` no resto |
| `aps.category` | `call` (botões Atender e Recusar) |
| `aps.interruption-level` | `time-sensitive` nas chamadas (entitlement já no `app.json`) |
| `aps.thread-id` | por conversa (`chat:…`, `group:…`), `calls`, ou a categoria |
| `body` | os dados para a app (`kind`, `callId`, `from`, `url`, `tag`…): o expo-notifications lê-os daqui |

Não se envia badge (o FCM também não envia). As preferências de notificação (categorias desligadas) valem para todos
os aparelhos.

Respostas da Apple: `410` e `400 BadDeviceToken` / `DeviceTokenNotForTopic` apagam o aparelho. `429`, `5xx` e as falhas de
rede tentam mais duas vezes, ao fim de 0,5 s e de 2 s. Um `403 ExpiredProviderToken` renova o JWT uma vez. O JWT é
renovado de 50 em 50 minutos.
