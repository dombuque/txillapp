# Txillada agendada: contrato

Como no Instagram: o anfitrião marca dia e hora para uma Txillada; quem a pode ver encontra-a no perfil dele (e numa fila
«Em breve»), toca em «Lembrar-me» e recebe o aviso quando começa. Na hora, o anfitrião recebe um aviso e começa com um toque,
com as escolhas que já fez (título, tipo, preço, meta).

## Base de dados (migração `0176_txillada_agendar.sql`)

- `content.txillada_schedules`:
  - `id uuid PK` (uuidv7), `host_id uuid NOT NULL` (identity.users, `ON DELETE CASCADE`);
  - `title text NOT NULL DEFAULT ''` (0 a 80, filtro de palavras como o título da Txillada);
  - `audience text NOT NULL` ('everyone' | 'friends' | 'close' | 'paid'), `price int` (5 a 5000, só e sempre com 'paid'),
    `goal int` (10 a 1 000 000, null sem Angariação), `goal_purpose text NOT NULL DEFAULT ''` (0 a 80);
  - `starts_at timestamptz NOT NULL`;
  - `status text NOT NULL DEFAULT 'scheduled'` ('scheduled' | 'started' | 'cancelled' | 'expired');
  - `txillada_id uuid` (FK content.txilladas, `ON DELETE SET NULL`): a Txillada que nasceu dela;
  - `host_reminded_at timestamptz` (aviso dos 15 minutos ao anfitrião), `host_now_at timestamptz` (aviso «é agora»);
  - `created_at`, `updated_at`.
  - Índices: `(host_id, starts_at) WHERE status = 'scheduled'`; `(starts_at) WHERE status = 'scheduled'`.
- `content.txillada_schedule_reminders`: `(schedule_id, user_id)` PK (FK com CASCADE), `created_at`. É o «Lembrar-me».
- `social.notifications.kind` ganha `'txillada_scheduled_soon'` (ao anfitrião: começa daqui a 15 min),
  `'txillada_scheduled_now'` (ao anfitrião: é agora) e `'txillada_scheduled_cancelled'` (a quem pediu lembrete). Usar o
  padrão da 0173 (lê a lista atual da restrição e junta os novos).
- Apagar a conta apaga os agendamentos da pessoa e os lembretes dela (CASCADE).
- A exportação de dados junta:
  - `txilladaSchedules`: os meus, com título, tipo, preço, meta, hora, estado e quantos pediram lembrete, sem nomes;
  - `txilladaReminders`: os lembretes que pedi, com o @ do anfitrião e a hora.

## Regras

- **Quem pode agendar:** as mesmas regras de quem pode abrir uma Txillada (conta ativa, 18+, sem suspensão, funcionalidade
  ligada). Os mesmos limites de tipo, preço e meta do `POST /txilladas`.
- `starts_at`: pelo menos 15 minutos à frente e no máximo 30 dias. Cada anfitrião tem no máximo 5 em 'scheduled'
  (409 `code: 'too_many'`). Dois agendamentos do mesmo anfitrião não podem estar a menos de 30 minutos um do outro
  (409 `code: 'too_close'`).
- **Quem vê:** quem poderia ver a Txillada com esse `audience`. Usar a mesma função de visibilidade da Txillada
  (txillada-visibility.ts): bloqueios, conta privada, amigos, amigos próximos. Uma paga mostra o cartão com o preço, e a
  entrada só se paga quando estiver a decorrer. Fora disto: 404.
- **Lembrar-me:** quem vê pode pedir e tirar o lembrete. O anfitrião não pode (400). No máximo 60 pedidos por minuto.
- **Começar:**
  - `POST /txilladas` aceita `scheduleId`. Com ele, usa título, tipo, preço e meta do agendamento; o corpo pode trazer um
    `title` novo.
  - Só o anfitrião, só com o agendamento em 'scheduled' e a partir de 60 minutos antes de `starts_at`. Antes disso dá 409
    `code: 'too_early'`; a app pode oferecer «Começar agora mesmo assim», que primeiro muda a hora para agora com o `PATCH`.
  - Ao começar, o estado passa a 'started' com o `txillada_id`. Todos os que pediram lembrete recebem logo a notificação
    `txillada_live` e o push, mesmo com o limite de 1 por hora para os seguidores. Os seguidores recebem a de sempre, com
    o limite de sempre e sem repetir a quem já recebeu pelo lembrete.
  - Começar uma Txillada normal (sem `scheduleId`) até 60 minutos antes de um agendamento meu liga-a a esse agendamento
    automaticamente, o mais próximo, para quem pediu lembrete não ficar à espera.
- **Avisos ao anfitrião:**
  - O mesmo trabalho de minuto a minuto do resto dos lembretes (vê `apps/api/src/reminders`) manda a notificação
    `txillada_scheduled_soon` com push 15 minutos antes: «A tua Txillada começa daqui a 15 min».
  - Na hora manda `txillada_scheduled_now` com push: «Está na hora da tua Txillada. N pessoas pediram para ser
    lembradas.»
  - Cada uma só uma vez.
- **Expirar:** 2 horas depois de `starts_at` sem começar, o estado passa a 'expired', sem avisos.
- **Cancelar:** o anfitrião cancela e o estado passa a 'cancelled'. Quem pediu lembrete recebe
  `txillada_scheduled_cancelled`, com push: «@x cancelou a Txillada de sábado, 20:00».
- **Editar:**
  - O anfitrião pode mudar `title` e `starts_at`, com as mesmas regras; o tipo, o preço e a meta não mudam.
  - Mudar a hora mais de 15 minutos manda a quem pediu lembrete uma notificação `txillada_scheduled_cancelled` com
    `data.moved: true`: «@x mudou a Txillada para domingo, 19:00».
  - Ao mudar a hora, os avisos ao anfitrião voltam a estar por mandar.
- **Limpeza:** os 'cancelled' e 'expired' com mais de 30 dias apagam-se, e os lembretes vão com eles. Os 'started' ficam
  enquanto a Txillada existir.

## API (prefixo /api/v1, com sessão)

| Rota | Quem | Resposta |
|---|---|---|
| `POST /txilladas/schedules` `{ title?, audience, price?, goal?, goalPurpose?, startsAt }` | quem pode abrir | 201 `ScheduledTxillada` · 400 (hora, preço, meta), 403 (regras de quem abre), 409 `too_many` / `too_close` |
| `GET /txilladas/schedules?username=<u>` | todos | `{ items: ScheduledTxillada[] }`: os 'scheduled' desse anfitrião que eu posso ver, por hora; sem `username`, os meus |
| `GET /txilladas/schedules/upcoming` | todos | `{ items: ScheduledTxillada[] }`: os 'scheduled' das próximas 48 h de quem eu sigo e posso ver, por hora (máx. 20) |
| `GET /txilladas/schedules/:id` | quem pode ver | `ScheduledTxillada` (também em 'started', 'cancelled' ou 'expired', para a ligação partilhada dizer o que aconteceu) |
| `PATCH /txilladas/schedules/:id` `{ title?, startsAt? }` | anfitrião | `ScheduledTxillada` · 409 se não está em 'scheduled' |
| `DELETE /txilladas/schedules/:id` | anfitrião | 204 (cancela) |
| `POST /txilladas/schedules/:id/remind` | quem vê (não o anfitrião) | `{ reminded: true, reminders }` |
| `DELETE /txilladas/schedules/:id/remind` | quem vê | `{ reminded: false, reminders }` |
| `POST /txilladas` `{ …, scheduleId? }` | anfitrião | como antes; ver «Começar» |

`ScheduledTxillada`:

```
{
  id, host: { id, username, displayName, avatarUrl, verified, verifiedTier },
  title, audience, kind, price, goal, goalPurpose, startsAt, status,
  txilladaId, live, isHost, reminded, reminders, createdAt
}
```

- `kind`: 'public' | 'friends' | 'paid', como no TxilladaDto.
- `txilladaId`: só quando está em 'started'.
- `live`: true se a Txillada que nasceu dela ainda está a decorrer.
- `reminders`: o número de lembretes, só para o anfitrião. Para os outros vai a null.

Perfil (`GET /users/:username` e o que já devolve `live`): ganha
`nextTxillada: { id, startsAt, title, reminded } | null`, o próximo agendamento que eu posso ver.

Notificações (forma de sempre; `data` leva `scheduleId`, `startsAt` e `title`):
- `txillada_scheduled_soon` e `txillada_scheduled_now` vêm do próprio anfitrião, como os avisos do sistema;
- `txillada_scheduled_cancelled` leva `data.moved`, e `data.newStartsAt` quando a hora mudou.

Tempo real: não é preciso. A app volta a pedir o agendamento ao abrir o cartão.

## App

- **Preparar a Txillada (TxilladaPrep):** ao lado de «Começar», a opção «Agendar».
  - Escolhes o dia com pastilhas (Hoje, Amanhã e os 5 dias seguintes; «Outro dia» abre um calendário simples do mês) e a
    hora com uma grelha de 15 em 15 minutos.
  - Não acrescentes módulos nativos: tudo em JS.
  - Ficam as mesmas escolhas de tipo, preço e meta.
  - Confirmar mostra «Agendada para sábado, 20:00», com «Partilhar» e «Ver no perfil».
- **Cartão do agendamento:** a rota `/txillada/agendada/[id]` abre uma folha ou ecrã.
  - Mostra a capa com o anfitrião e o selo, o título, o tipo (com o preço numa paga e a meta numa Angariação), o dia e a
    hora e uma contagem («Começa daqui a 2 h 15 min» ou «Amanhã às 20:00»).
  - Quem vê: botão «Lembrar-me», que passa a «Vais ser lembrado» com um visto, e «Partilhar».
  - O anfitrião vê:
    - «N pessoas pediram para ser lembradas»;
    - «Começar», ativo a partir de 60 min antes; antes disso «Começar agora» com confirmação;
    - «Editar» (título, dia e hora) e «Cancelar a Txillada», com confirm() e a vermelho.
  - Em 'started' e a decorrer, mostra «Está a decorrer» e «Entrar»; já acabada, «Já acabou». Em 'cancelled' mostra «O
    anfitrião cancelou esta Txillada»; em 'expired', «Não chegou a começar».
- **Perfil:**
  - Com `nextTxillada`, aparece um cartão por baixo da bio: ícone da Txillada, «Txillada agendada», o título, «Sáb, 20:00» e
    o botão «Lembrar-me».
  - No meu perfil diz «A tua Txillada agendada» e leva ao cartão.
  - Se houver mais agendamentos meus, aparece a ligação «Ver todas (N)».
- **Em breve:** onde a app mostra as Txilladas a decorrer (a fila dos mimos ou a lista «Ao vivo»), uma fila «Em breve» com
  `GET /txilladas/schedules/upcoming`, em cartões pequenos com hora e «Lembrar-me». Não deve atrapalhar a fila dos mimos;
  se não couber bem, fica dentro da lista das Txilladas a decorrer.
- **Notificações:**
  - Os três tipos novos têm texto e destino: o cartão do agendamento, ou o «Começar» para o anfitrião.
  - O `txillada_live` vindo de um lembrete diz «@x começou a Txillada que pediste para lembrar».
- **Textos:** português, por «tu», sem emojis nem travessões, aspas «». Hora no formato de Moçambique: «sáb., 20:00» ou
  «sábado, 20:00», com o fuso do telemóvel.
- **Selo:** em todo o lado onde aparece o anfitrião.
