# Escala: várias instâncias da API numa máquina

Como a API aguenta milhares de pessoas ligadas ao mesmo tempo no mesmo servidor (6 núcleos, 12 GB): vários processos da
API atrás do nginx, o tempo real e os limites de pedidos no Redis, e o trabalho pesado num processo à parte.
O código está em `apps/api/src/realtime/` (o RealtimeBus, o Scheduler, os limites) e `apps/api/src/common/role.ts`;
a infraestrutura em `infra/prod/` (compose, nginx, Prometheus).

## Arquitetura

```
                Cloudflare
                    │ HTTPS
                 ┌──▼───┐   least_conn, resolve (as réplicas entram e saem sozinhas)
                 │nginx │───────────────┬───────────────┐
                 └──────┘               │               │
               ┌────────▼───┐   ┌───────▼────┐   ┌──────▼─────┐
               │ api (web)  │   │ api (web)  │   │ api (web)  │   API_REPLICAS=3, ROLE=web
               │ SSE, REST  │   │ SSE, REST  │   │ SSE, REST  │   pedidos, fotos (verificação inline)
               └──┬────┬────┘   └──┬────┬────┘   └──┬────┬────┘
                  │    └─────────┐ │    │  ┌────────┘    │
                  │      pub/sub, quem está ligado,       │
                  │      limites de pedidos               │
                  │            ┌──▼─▼────▼──▼┐            │
                  │            │    Redis    │◄───────┐   │
                  │            └─────────────┘        │   │
               ┌──▼───────────────────────────────────┼───▼┐
               │              PostgreSQL 17            │    │   compose_jobs, video_jobs (filas)
               └──▲────────────────────────────────────┼────┘
                  │                                    │
               ┌──┴────────────────────────────────────┴┐
               │ worker (ROLE=worker)                    │   tarefas periódicas, montagem das tchekas,
               │ /health e /metrics, sem tráfego         │   conversão dos vídeos, silenciar sons
               └─────────────────────────────────────────┘
```

- **`api` (ROLE=web)**: N réplicas iguais (`deploy.replicas`, `API_REPLICAS`, 3 por omissão). Só servem pedidos: REST, o
  canal em tempo real (SSE) e a verificação das fotos (fica inline: o envio espera por ela, ver abaixo). Não correm
  tarefas periódicas nem filas.
- **`worker` (ROLE=worker)**: um processo, a mesma imagem. Corre as 26 tarefas periódicas e de arranque (lista em
  «Tarefas periódicas»), a fila da montagem das tchekas, a conversão dos vídeos e o silenciar/repor/tirar o som das
  tchekas. Escuta na porta 3000 só para o healthcheck e para o Prometheus.
- **Sem ROLE** (desenvolvimento e testes): um processo faz tudo, como antes.
- **`migrate`**: corre uma vez antes de qualquer `api` ou `worker` arrancar (`depends_on: service_completed_successfully`),
  e o `migrate.ts` ainda segura um `pg_advisory_lock`, por isso nunca há duas migrações ao mesmo tempo.

### Tempo real (RealtimeBus)

`ChatEvents` (o canal SSE, `chat/chat.events.ts`) passou a ser uma camada fina por cima do **RealtimeBus**
(`realtime/realtime-bus.ts`), com duas implementações e a mesma interface:

| | sem `REDIS_URL` (dev, testes) | com `REDIS_URL` (produção) |
|---|---|---|
| eventos para uma pessoa | entregues na memória | entregues já às ligações desta instância e publicados no canal `rt:ev`; as outras instâncias entregam às suas (cada uma ignora o que ela própria publicou) |
| sinais entre instâncias (`compose.kick`, `video.kick`, `sounds.*`, `music.catalog.invalidate`) | na memória | canal `rt:sig` |
| quem está ligado | contagem por pessoa | `rt:on:<id>`: conjunto ordenado com um membro por instância e a hora até quando vale; cada instância renova de 20 em 20 s, uma instância que morre deixa de contar ao fim de 60 s |
| conversa à vista (sem aviso no telemóvel) | `Map` | `rt:act:<id>`, TTL 45 s |
| «a escrever» num post | `Map` | `rt:ptyp:<post>`, conjunto com hora, TTL 6 s |
| pesquisas (o termo à espera e «uma vez por dia») | `Map`/`Set` | `rt:ss:p:<id>` (só quem pôs o último termo o conta) e `rt:ss:seen:<hash>` (NX, 26 h) |

Se o Redis falhar, cada operação cai para a memória da instância (conta em `realtime_redis_errors_total` e avisa uma vez
por minuto nos registos): os eventos continuam a chegar a quem está ligado à mesma instância, e o resto volta ao normal
quando o Redis voltar. `/api/v1/health/ready` mostra `"redis": "up" | "down" | "off"` sem tirar a instância do ar.

### Limites de pedidos

O limite geral (120 por minuto) e todos os `@Throttle` contam no Redis (`@nest-lab/throttler-storage-redis` 1.2, feito
para o `@nestjs/throttler` 6, que é o instalado: 6.7), iguais em todas as réplicas. Se o Redis falhar, a contagem desse
pedido faz-se na memória da instância (`throttler_redis_fallback_total`): o pedido nunca falha por causa do Redis.
Os limites contados na base de dados (montagens por hora, pré-visualizações de voz, SuperTxill…) não mudaram.

### Filas (montagem das tchekas e vídeos)

As duas filas são tabelas: `content.compose_jobs` (já existia) e `content.video_jobs` (migração 0148).

- Quem envia (uma réplica web) guarda o trabalho e dá um toque ao worker (`compose.kick` / `video.kick`). O worker também
  olha para a fila de 2 em 2 s, para o caso de o toque se perder.
- O worker apanha o trabalho com um claim atómico:
  `UPDATE … SET status = 'working', worker_id = $1, heartbeat_at = now() WHERE id = (SELECT id … WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)`.
  Dois workers nunca apanham o mesmo trabalho (testado em `compose/queue.e2e.spec.ts`).
- Enquanto trabalha, renova `heartbeat_at` (de 15 em 15 s, e a cada progresso). Um trabalho «a correr» sem sinal de vida
  há mais de 2 minutos é de um processo que caiu: a montagem passa a falhada («Tenta outra vez», como antes num
  reinício); o vídeo volta para a fila (no máximo 2 tentativas, depois falha com «Tenta outro formato»).
- O estado e o progresso já estavam na base de dados, por isso a app pergunta a qualquer réplica.

**A verificação de nudez fica inline nas réplicas web.** O envio de uma foto espera pelo veredicto (a recusa tem de voltar
logo na resposta), e o modelo corre em ~0,2–0,5 s. Passá-la para o worker poupava ~0,5 GB de memória por réplica (os
modelos ONNX deixavam de carregar nas web), mas punha cada envio de foto atrás das montagens e dos vídeos do worker (que
podem ocupar os núcleos dele durante minutos) e somava a ida e volta da fila: pior para quem envia. Os vídeos já são
verificados no worker (as 3 imagens tiradas durante a conversão). Se um dia a memória apertar, a opção é um segundo
worker só para fotos, com uma fila de prioridade alta e o pedido a esperar até ~5 s.

**As pré-visualizações de voz** (`/tchekas/compose/voice-preview`) também ficam nas web: a pessoa está à espera, são curtas
(até 60 s de áudio, 1 de cada vez por réplica, 8 em espera). Com 3 réplicas podem correr 3 ao mesmo tempo. Dois toques
seguidos que caiam em réplicas diferentes fazem o trabalho duas vezes (o segundo fica com outro id): só gasta CPU.

### Tarefas periódicas

Todas passam pelo `Scheduler` (`realtime/scheduler.ts`): só correm no worker (ou sem ROLE); nas réplicas web ficam
registadas mas paradas. Uma tarefa não se sobrepõe a ela própria. No arranque o worker escreve nos registos a lista
(`papel worker: 26 tarefas de fundo (…)`); as réplicas escrevem `papel web: sem tarefas de fundo`.

`analytics.user_days`, `search.purge`, `chat.expiry`, `gelada.friday`, `geleira.level`, `invites.sweep`, `media.unused`,
`media.deleted`, `moderation.evidence`, `music.catalog`, `music.catalog.stale`, `music.licensed` (só com fornecedor),
`iap.sweep` (só com IAP_ENABLED), `nearby.presence`, `reminders.comeback`, `reminders.verify`, `sounds.backfill`,
`sounds.silence`, `calls.sweep`, `calls.purge`, `instants.thumbs`, `posts.topics`, `compose.sweep`, `compose.poll`,
`compose.stale`, `video.poll`, `video.stale`, `security.purge`.

### Inventário do estado em memória

Passou a ser partilhado (Redis ou base de dados):

| Onde | O quê | Agora |
|---|---|---|
| `chat/chat.events.ts` | `Subject` dos eventos SSE | RealtimeBus, canal `rt:ev` |
| `chat/chat.events.ts` | `open` (quem tem o canal aberto) | `rt:on:<id>` com validade por instância |
| `chat/chat.events.ts` | `active` (conversa à vista) | `rt:act:<id>`, TTL 45 s |
| `chat/presence.controller.ts` | `typing` («a escrever» nos posts) | `rt:ptyp:<post>`, TTL 6 s |
| `analytics/search-stats.service.ts` | `pending` (termo à espera) e `seen` (uma vez por dia) | `rt:ss:p:<id>` e `rt:ss:seen:<hash>` |
| `ThrottlerModule` | contagens dos limites | Redis (`th:…`) |
| `security/rate-store.ts` | travões da segurança (logins falhados, bloqueios, registos por rede, emails) | Redis (`sec:c:…`, `sec:l:…`, `sec:s:…`); sem Redis ou se ele falhar, `security.counters` e `security.locks` (`security_rate_redis_fallback_total`) |
| `compose/compose.service.ts` | `queue` (fila em memória) | `content.compose_jobs` + `FOR UPDATE SKIP LOCKED` |
| `media/video.service.ts` | `chain` (fila em memória) | `content.video_jobs` |
| `sounds/sounds.service.ts` | `chain` (silenciar, repor, tirar o som de tchekas novas) pedido nas web | sinais `sounds.*` para o worker; a volta de 10 min e a de 30 min apanham o que se perder |
| `music/catalog/catalog.service.ts` | `snap` (cache do catálogo) | continua por instância (2 min), mas esquecer a cache esquece-a em todas (`music.catalog.invalidate`) |
| 26 `setInterval`/`setTimeout` de arranque | tarefas periódicas | Scheduler, só no worker |

Fica na memória de cada instância, de propósito:

| Onde | Porquê não faz mal |
|---|---|
| `calls/calls.service.ts`: `timers`, `repeats` (fim do toque, reenvios do Web Push) | o estado está na base de dados e cada mudança é `UPDATE … WHERE status = 'ringing'`: atender noutra réplica faz o temporizador desta não fazer nada; uma réplica que reinicia é apanhada pela varredura do worker (15 s) |
| `calls/calls.service.ts`: `offlineSince` | só a varredura o usa e ela só corre no worker; quem está ligado vem do Redis |
| `analytics/analyses.service.ts` `cache`, `search/search.service.ts` `trendingCache`, `gifs` `cache`, `places` (3 caches), `invites` `ogCache`, `compose/analyze.service.ts` `cache`, `music/catalog` `totals`, `nearby/schema-probe.ts` | caches com validade curta; cada réplica tem a sua (no pior caso, a mesma conta feita 3 vezes) |
| `security/hash-gate.ts` (vagas do argon2), `security/risk.service.ts` `unscored` | as vagas são do CPU de cada processo; `unscored` só guarda contas antigas sem pontuação (a das novas nasce na transação do registo) |
| `auth/auth.service.ts` `countrySeen` | só evita um UPDATE repetido; noutra réplica faz-se o UPDATE (que não muda nada) |
| `media/media.service.ts` `making`, `fresh`, `chatVariantsMade` | juntam pedidos iguais em curso e guardam bytes acabados de chegar; noutra réplica só se repete trabalho |
| `compose/voice-preview.service.ts` `inflight`, a vaga do ffmpeg | ver «pré-visualizações de voz» acima |
| `search/search-index.ts` `jobs` | junta as indexações seguidas do mesmo post (Elasticsearch, desligado por omissão); cada réplica indexa o que mudou nela |
| `iap/apple.ts`, `iap/google.ts` (token), `push/push.service.ts` (`apnsWarned`), `music/licensed-music.service.ts` (`providers`), caches de desenho (`compose/capulana*.ts`, `studio-canvas.ts`) | credenciais e registos por processo |
| `nearby/events.service.ts` | não tem estado em memória (os eventos dos locais estão na base de dados) |

## Ligações ao PostgreSQL

Cada processo tem um pool de `PG_POOL_MAX` ligações (20 por omissão; o worker 10), com `statement_timeout`
(`PG_STATEMENT_TIMEOUT_MS`: 30 s nas réplicas, 5 min no worker) e `idle_in_transaction_session_timeout` (60 s). O nome
de cada um (`txillapp-web`, `txillapp-worker`) aparece em `pg_stat_activity.application_name`.

```
ligações = N × PG_POOL_MAX(web) + PG_POOL_MAX(worker) + migrate + backup + exportador + psql + reservadas
         = 3 × 20 + 10 + 1 + 1 + 2 + 3 + 3 = 81   ≤ max_connections = 100
```

O backoffice (admin.txillapp.com) usa as mesmas réplicas da API, por isso já está nas 60. Com `API_REPLICAS=4` a conta
dá 101: sobe `max_connections` para 150 no `command` do `postgres` (cada ligação parada custa ~5–10 MB; o risco real é o
`work_mem` de 16 MB por ordenação em consultas ao mesmo tempo, por isso não passar de ~150 sem baixar o `work_mem`).
Ver as ligações: `SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1, 2 ORDER BY 3 DESC;`.

## Capacidade estimada

Estimativa (não é um teste de carga: confirmar com os painéis do Grafana quando a carga subir):

- **Pessoas com a app aberta (SSE):** cada uma tem uma ligação longa. O limite é o menor de:
  - nginx: `worker_processes × worker_connections / 2` = 6 × 8192 / 2 ≈ **24 mil** (cada SSE usa duas ligações no nginx);
  - réplicas: cada ligação SSE custa ~30–60 KB no Node; com ~0,7 GB de base por réplica e 1,5 GB de limite, ~10 mil por
    réplica, **~30 mil** com 3;
  - Redis: ~0,2 KB por pessoa ligada (+ os limites de pedidos, ~1–2 KB por IP ativo no último minuto): 20 mil pessoas
    ≈ 40 MB dos 256 MB.
- **Pedidos por segundo:** `N × R`, com R ≈ 300–600 pedidos/s por réplica para pedidos de 2 a 5 consultas (CPU do Node,
  1 núcleo por réplica), até a base de dados mandar: `60 ligações × 1000 / t_consulta_ms ÷ consultas_por_pedido`
  (5 ms e 3 consultas: ~4 000 pedidos/s). Com 3 réplicas: **~1 000–1 800 pedidos/s**.
- **Pessoas ativas ao mesmo tempo** ≈ pedidos/s ÷ pedidos por pessoa ativa (~0,3/s a deslizar o feed e a conversar):
  **~3 000–6 000 ativas**, com até ~20 mil só com a app aberta.

Fórmula curta: `ativas ≈ min(N × R, 60 × 1000 / (t × q)) / 0,3` e `ligadas ≈ min(24 000, N × 10 000)`.
O que aperta primeiro: a CPU (montagens e vídeos no worker competem com as réplicas pelos 6 núcleos; o worker tem
`COMPOSE_CONCURRENCY=1` e `VIDEO_CONCURRENCY=1`) e as consultas lentas (`log_min_duration_statement=500`).

## Observabilidade

- Cada réplica e o worker expõem `/api/v1/metrics` (com `METRICS_TOKEN`). O Prometheus encontra as réplicas pelo DNS do
  Docker (`dns_sd_configs`, nome `api`): cada uma é um alvo com a sua `instance` (IP:3000). O worker é o job
  `txillapp-worker`. Todas as séries trazem `role` (`web`/`worker`), posta pela API.
- Métricas novas: `realtime_sse_connections` (ligações SSE por instância), `realtime_published_total{kind}`,
  `realtime_redis_errors_total{op}`, `throttler_redis_fallback_total`, `periodic_task_runs_total{task,result}`,
  `pg_pool_connections`, `pg_pool_idle`, `pg_pool_waiting`. E o `redis-exporter` (perfil `monitoring`).
- Juntar as réplicas no Grafana:
  - pedidos por segundo: `sum(rate(http_request_duration_seconds_count{role="web"}[5m]))`
  - p95 por rota: `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{role="web"}[5m])))`
  - pessoas ligadas: `sum(realtime_sse_connections)` e por réplica `realtime_sse_connections` (deve estar equilibrado)
  - pool a esperar: `max by (instance) (pg_pool_waiting) > 0`
  - tarefas que falham: `sum by (task) (increase(periodic_task_runs_total{result="error"}[1h]))`
- O nginx regista a réplica de cada pedido (`up=IP:3000` no access log).

## Como escalar a seguir

1. **Mais réplicas nesta máquina**: `API_REPLICAS=4` (ou 5) no `.env` e `docker compose up -d api`. Com 6 núcleos, mais
   de 4–5 réplicas tira CPU ao worker e ao PostgreSQL. Rever a conta das ligações (acima).
2. **Separar o PostgreSQL** (Postgres gerido, ou uma máquina só para ele): `DATABASE_URL` novo no compose. Os geridos
   têm limites de ligações apertados: pôr um PgBouncer em modo *transaction* à frente (o código não usa `LISTEN`, nem
   prepared statements com nome, e os `pg_advisory_xact_lock` são por transação; as migrações (`migrate`, com
   `pg_advisory_lock` de sessão) vão diretas à base, sem o PgBouncer). Baixar `PG_POOL_MAX` em conformidade.
3. **Segunda máquina para a API**: as réplicas não guardam nada de que as outras precisem (tempo real e limites no
   Redis, filas na base, ficheiros no R2; `STORAGE_DRIVER=s3` é obrigatório: o volume `uploads` não é partilhado entre
   máquinas). Rede privada entre as máquinas (WireGuard ou a rede privada da Contabo); o Redis e o PostgreSQL só nessa
   rede, com senha. O nginx da máquina A ganha os IPs da B no `upstream txill_api` (ou um Load Balancer do Cloudflare à
   frente dos dois nginx). O worker fica num sítio só (ou vários: as filas aguentam; as tarefas periódicas não, ficam
   num só worker, ou passam a ter um `pg_try_advisory_lock` por tarefa).
4. **Redis**: se passar dos 256 MB ou quiser mais segurança, um Redis gerido (o código só usa comandos simples, pub/sub
   e um script Lua; nada de Redis Cluster). O pub/sub manda cada evento a todas as instâncias: até ~10 réplicas é
   barato; daí para cima, passar a canais por pessoa.

## Deploy: a primeira publicação com réplicas

Esta publicação muda o compose (o `api` passa de 1 contentor para 3, aparece o `worker`, o nginx muda o upstream) e traz a
migração 0148 (só acrescenta: colunas novas em `compose_jobs` e a tabela `video_jobs`). O corte é o de sempre (~40 s
enquanto as réplicas arrancam), porque o nginx novo só entra depois de as réplicas estarem saudáveis.

### Antes (no PC)

O ramo está no `main` e no GitHub (o servidor faz `git pull --ff-only`). Ver `docs/DEPLOY.md`, secção 6.

### No servidor

```bash
ssh txillapp
cd /opt/txillapp
git rev-parse HEAD | tee /opt/txillapp/.antes-da-escala     # o commit para voltar atrás
cd infra/prod
grep -c '^REDIS_PASSWORD=.' .env                             # tem de dar 1 (a senha do Redis preenchida)

# 1) Guardar as imagens atuais (o rollback não precisa de compilar)
docker tag txillapp-api:latest  txillapp-api:antes-escala
docker tag txillapp-edge:latest txillapp-edge:antes-escala

# 2) Código novo e imagens novas (o site continua no ar durante o build)
cd /opt/txillapp && git pull --ff-only && cd infra/prod
docker compose build api nginx

# 3) Redis de pé e a migração 0148 (aditiva: a API antiga continua a funcionar com ela)
docker compose up -d redis
docker compose run --rm migrate

# 4) A troca: 3 réplicas + worker; o nginx novo entra quando as réplicas estiverem saudáveis
docker compose up -d api worker nginx
docker compose ps api worker nginx                           # api-1, api-2, api-3, worker: (healthy)

# 5) Limpar
docker image prune -f && docker builder prune -f --keep-storage 10GB
```

Com o perfil de monitorização: `docker compose --profile monitoring up -d prometheus redis-exporter` (o Prometheus lê o
`prometheus.yml` novo ao recriar).

### O que verificar depois

```bash
cd /opt/txillapp/infra/prod
# Papéis: as réplicas sem tarefas, o worker com as 26, todos ligados ao Redis
docker compose logs api    | grep -E 'papel web|tempo real e limites partilhados'      # 3 de cada
docker compose logs worker | grep -E 'papel worker|tempo real e limites partilhados'
curl -s https://txillapp.com/api/v1/health/ready                                       # {"status":"ready","db":"up","redis":"up"}

# Tempo real: 4 subscritores em cada canal (3 réplicas + worker) e as pessoas ligadas
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PUBSUB NUMSUB rt:ev rt:sig'
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "rt:on:*" | wc -l'

# Os pedidos repartidos pelas réplicas (o IP de cada uma em up=…)
docker compose exec nginx sh -c 'tail -n 300 /var/log/nginx/access.log | grep -o "up=[0-9.:]*" | sort | uniq -c'

# Ligações ao PostgreSQL por papel (web até 60, worker até 10)
docker compose exec postgres psql -U txill -d txillapp -c "SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC"
```

Com dois telemóveis (contas diferentes):

1. **SSE**: abrir a mesma conversa nos dois; enviar mensagens e escrever: chegam logo e aparece «a escrever…». Fechar a
   app num e ver «online» a sair no outro (até ~1 minuto se a ligação cair sem fechar).
2. **Chamadas**: ligar de um para o outro (toca, atende, ouve-se, desliga); ligar e não atender (fica perdida ao fim de
   45 s, nos dois). `docker compose logs worker | grep Chamadas` sem erros.
3. **Montagem**: montar uma tcheka no estúdio da app nativa; acaba e publica. Na base:
   `SELECT status, worker_id, heartbeat_at FROM content.compose_jobs ORDER BY created_at DESC LIMIT 3;` → `done`, com o
   `worker_id` do contentor do worker.
4. **Vídeo**: publicar um vídeo; fica pronto. `SELECT count(*) FROM content.video_jobs;` → 0 quando acabam.
5. **Limites**: `docker compose logs api | grep -c 'Redis indisponível'` → 0.

### Rollback

A migração 0148 fica (só acrescenta; a versão anterior ignora-a). Antes de voltar atrás, deixar a fila dos vídeos esvaziar
(`SELECT count(*) FROM content.video_jobs;` → 0), porque a versão anterior não lê essa tabela: um vídeo que lá fique
fica «a processar» e a pessoa tem de o enviar outra vez.

```bash
cd /opt/txillapp
git checkout "$(cat /opt/txillapp/.antes-da-escala)" -- infra/prod apps/web/Dockerfile   # o compose e o nginx de antes
cd infra/prod
docker tag txillapp-api:antes-escala  txillapp-api:latest
docker tag txillapp-edge:antes-escala txillapp-edge:latest
docker compose up -d --remove-orphans api nginx      # volta a 1 contentor api; o worker sai (órfão)
docker compose ps
git -C /opt/txillapp status --short                   # depois: git checkout -- . e git pull quando a correção estiver no main
```

Sem as imagens guardadas: `git checkout <commit-anterior>` (todo o repositório), `docker compose build api nginx` e o mesmo
`up -d --remove-orphans api nginx`.

Voltar atrás só no número de réplicas (sem tirar o worker nem o Redis): `API_REPLICAS=1 docker compose up -d api`.
