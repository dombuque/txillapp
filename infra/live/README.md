# Servidor da Txillada (live.txillapp.com)

Máquina à parte (173.212.195.105, Ubuntu 24.04, `ssh deploy@…` com a chave txillapp-deploy; root e senha desligados),
em `/opt/txillapp-live`: **LiveKit** (vídeo ao vivo, WebRTC, com o TURN dele na porta UDP 443), **Caddy** (HTTPS de
live.txillapp.com, sem HTTP/3 para deixar a UDP 443 ao TURN; noindex) e **coturn** (TURN das chamadas, porta 3478, ainda
não usado: as chamadas continuam no coturn da máquina principal até se mudar `turn.txillapp.com`).

- Segredos em `/opt/txillapp-live/.env` (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, TURN_SECRET); a API tem os dois primeiros e
  `LIVEKIT_URL=wss://live.txillapp.com` no `.env` de produção.
- `livekit.yaml.example`: o `livekit.yaml` com as chaves tiradas. Webhook para a API: `/api/v1/txilladas/livekit-webhook`.
- Nada se grava (sem egress). Registos técnicos: no máximo 7 dias (`cron-logs.sh` em /etc/cron.daily/txillapp-logs).
- Firewall (ufw): 22, 80, 443/tcp, 443/udp, 7881/tcp, 3478/tcp+udp, 5349/tcp, 30000-40000/udp, 49160-49200/udp,
  50000-60000/udp. fail2ban no ssh; atualizações automáticas de segurança.
- Atualizar: `cd /opt/txillapp-live && docker compose pull && docker compose up -d`.

## SuperTxill (modelo de IA aberto, em `llm.txillapp.com`)

O SuperTxill (a IA do Txillapp) responde com um modelo aberto a correr aqui, em CPU, no contentor **ollama**
(`docker-compose.yml`): só texto, sem custo por mensagem, e as conversas não saem dos nossos servidores. A API (máquina
principal) chama `https://llm.txillapp.com/api/chat` com `Authorization: Bearer <OLLAMA_TOKEN>`; as ferramentas (malta
perto, sítios, eventos, Txilladas, geleira, Malta para ti) correm na API, junto à base de dados, e só o resultado (sem
coordenadas) vem para o modelo.

- **Os lives têm prioridade:** o ollama tem no máximo 3 CPUs (`cpus: 3`), 6 GB (`mem_limit`), peso de CPU baixo
  (`cpu_shares: 256`: com a máquina apertada o LiveKit passa à frente) e `oom_score_adj: 500` (é o primeiro a sair se
  faltar memória). Responde a um pedido de cada vez (`OLLAMA_NUM_PARALLEL=1`, os outros esperam, até 8). A API também tem a sua fila: 1 resposta
  de cada vez por processo (`SUPERTXILL_CONCURRENCY`); com os 3 processos `api`, chegam aqui no máximo 3 pedidos ao mesmo tempo.
- **Só ouve em 127.0.0.1:11434.** O Caddy (`llm.txillapp.com`) só deixa passar `/api/chat` e `/api/version` com o token
  certo; o resto (sem token, outro token, `/api/pull`, `/api/delete`…) dá 401. Sem `OLLAMA_TOKEN` no `.env`, dá sempre 401.
  noindex e robots.txt a fechar tudo.
- Modelo: **qwen3:4b-instruct** (~2,5 GB no disco, ~3,5–4 GB de memória com 8k de contexto). Fica carregado 24 h (`OLLAMA_KEEP_ALIVE`).
- **Tempo de resposta:** em CPU cada resposta leva dezenas de segundos (a app mostra «SuperTxill está a pensar…»). As
  instruções e as ferramentas (~2200 tokens) vão sempre iguais à frente, e o Ollama guarda-as já lidas: só o 1.º pedido
  depois de arrancar é lento (num portátil i5-1245U com 3 CPUs: 1 a 4 min). Depois, num portátil com 3 CPUs: ~3–4 tokens/s
  a escrever, 20–40 s por resposta; aqui deve ser parecido ou melhor (medir com o passo 5). A API desiste aos 90 s
  (`SUPERTXILL_TIMEOUT_MS`) e responde «Pensei demais…». Para aquecer depois de um arranque, fazer uma pergunta qualquer.
- Sem raciocínio à parte (`OLLAMA_THINK=off`): em CPU um modelo que «pensa» escreve ~1000 tokens antes de responder
  (vários minutos). As perguntas sobre malta, sítios, eventos e Txilladas já levam os dados da app antes de o modelo
  responder (a API adivinha a ferramenta pelas palavras e corre-a), o que poupa uma volta e evita respostas inventadas.

### Ligar (passos exatos)

1. **DNS:** registo `A` `llm.txillapp.com` → `173.212.195.105`, como o `live` (sem o proxy da Cloudflare: as respostas
   podem demorar mais de 100 s e o Caddy trata do HTTPS).
2. **Token** (na máquina da Txillada, `ssh txillmedia`):
   ```sh
   cd /opt/txillapp-live
   echo "OLLAMA_TOKEN=$(openssl rand -hex 32)" >> .env   # guardar o valor: vai também para o .env da API
   grep OLLAMA_TOKEN .env
   ```
3. **Ficheiros:** copiar `infra/live/docker-compose.yml` e `infra/live/Caddyfile` deste repositório para `/opt/txillapp-live/`
   (ex.: `scp infra/live/{docker-compose.yml,Caddyfile} txillmedia:/opt/txillapp-live/`).
4. **Arrancar** (não mexe no LiveKit nem no coturn):
   ```sh
   cd /opt/txillapp-live
   docker compose pull ollama
   docker compose up -d ollama caddy          # o caddy recria-se para ler o OLLAMA_TOKEN e a rota nova
   docker compose exec ollama ollama pull qwen3:4b-instruct
   docker compose exec ollama ollama list
   ```
5. **Provar** (de qualquer lado):
   ```sh
   T=<o token>
   curl -s -o /dev/null -w '%{http_code}\n' https://llm.txillapp.com/api/version                    # 401
   curl -s -H "Authorization: Bearer $T" https://llm.txillapp.com/api/version                         # {"version":...}
   curl -s -H "Authorization: Bearer $T" https://llm.txillapp.com/api/chat \
     -d '{"model":"qwen3:4b-instruct","stream":false,"think":false,"messages":[{"role":"user","content":"Olá! Responde numa frase."}]}'
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" https://llm.txillapp.com/api/pull -d '{}'  # 401
   ```
6. **API** (máquina principal, `ssh txillapp`, `/opt/txillapp/infra/prod/.env`):
   ```sh
   OLLAMA_URL=https://llm.txillapp.com
   OLLAMA_TOKEN=<o mesmo token>
   OLLAMA_MODEL=qwen3:4b-instruct
   OLLAMA_NUM_THREAD=3
   # opcionais: SUPERTXILL_PROVIDER=ollama  SUPERTXILL_TIMEOUT_MS=90000  SUPERTXILL_CONCURRENCY=1
   ```
   e depois `cd /opt/txillapp/infra/prod && docker compose build api && docker compose up -d api` (as respostas são
   preparadas no processo `api` que recebeu a pergunta, não no worker).
7. **Ver:** perguntar ao SuperTxill na app. Registos: `docker compose logs -f ollama` (aqui) e `docker compose logs api | grep SuperTxill` (lá).

### Desligar ou aliviar

- Desligar já: `SUPERTXILL_PROVIDER=off` no `.env` da API e `docker compose up -d api` (responde «ainda estou a acordar»).
  Aqui: `docker compose stop ollama`.
- Se os lives sofrerem (ver `docker stats`): baixar `cpus` para 2 (e `OLLAMA_NUM_THREAD=2` na API) e `docker compose up -d ollama`.
- Trocar de modelo: `docker compose exec ollama ollama pull <modelo>`, mudar `OLLAMA_MODEL` na API e apagar o antigo com
  `docker compose exec ollama ollama rm qwen3:4b-instruct`.
