# Pôr o Txillapp no ar (txillapp.com)

Arquitetura: **1 servidor (Contabo Cloud VPS) + Docker Compose + Nginx + PostgreSQL + Redis + Cloudflare (DNS/CDN/segurança) + Cloudflare R2 (ficheiros) + cópias de segurança cifradas para fora do servidor**. Tudo o que é código/config está em `infra/prod/` e nos `Dockerfile` de `apps/api` e `apps/web`.

## 1. Subdomínios

| Subdomínio | O que é | Como |
|---|---|---|
| `app.txillapp.com` | A aplicação (PWA). **A API também responde aqui em `/api`** | Cloudflare (laranja) → nginx |
| `api.txillapp.com` | A mesma API, para apps nativas (Capacitor) e integrações | Cloudflare (laranja) → nginx |
| `media.txillapp.com` | Fotos, capas e vídeos aprovados | Domínio personalizado do **bucket público** do R2 |
| `admin.txillapp.com` | Moderação e estatísticas | Cloudflare (laranja) → nginx, **protegido por Cloudflare Access** |
| `monitor.txillapp.com` | Grafana | Cloudflare (laranja) → nginx, **protegido por Cloudflare Access** |

**Porque a app usa `/api` no mesmo endereço (e não `api.` como único caminho):** sem CORS, sem pedidos de pré-verificação (menos latência por pedido), os cookies de sessão ficam num só sítio e o tempo real (chat) é mais simples. `api.txillapp.com` fica pronto para a app nativa mais tarde.

A moderação e as métricas **não** existem em `app.` nem em `api.` (o nginx devolve 404): só em `admin.`.

## 2. O que tens de criar (eu não consigo fazer isto por ti)

1. **Domínio** `txillapp.com` e conta **Cloudflare** (passar os nameservers do domínio para o Cloudflare).
2. **VPS** Contabo (Ubuntu 24.04 LTS). Anota o IP.
3. **R2**: dois buckets: `txillapp-media` (com domínio personalizado `media.txillapp.com`) e `txillapp-private` (**sem** acesso público). Cria uma chave de API (Object Read & Write) limitada a esses dois. **CORS** nos dois buckets, senão o browser bloqueia os envios diretos:
   `[{"AllowedOrigins":["https://app.txillapp.com"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]`
   Um **API Token** do Cloudflare (Zone → DNS → Edit, só `txillapp.com`) para o certbot renovar os certificados.
4. **Cópias de segurança**: um bucket noutro fornecedor (recomendado: Backblaze B2) chamado `txillapp-backups`, e um par de chaves `age` (`age-keygen`): a **pública** vai para o servidor, a **privada** guardas fora dele (gestor de senhas + papel).
5. (Opcional) Google OAuth, conta no healthchecks.io, e-mail transacional.

## 3. DNS e Cloudflare

- Registos **A** (laranja/proxied) para `app`, `api`, `admin`, `monitor` → IP do VPS. `media` fica ligado ao R2 (o Cloudflare cria o registo ao adicionares o domínio personalizado).
- SSL/TLS: modo **Full (strict)**; o certificado é **Let's Encrypt** (desafio DNS no Cloudflare, renovado sozinho pelo contentor `certbot`; ver secção 5). O token fica em `infra/prod/certbot/cloudflare.ini` no servidor (nunca no Git).
- **Always Use HTTPS**, **HSTS**, **Min TLS 1.2**.
- **Cloudflare Access** (Zero Trust, grátis até 50 pessoas): aplicações para `admin.txillapp.com` e `monitor.txillapp.com`, permitindo só os teus e-mails. É uma 2.ª porta à frente do login da app.
- WAF: regras geridas ligadas; **Turnstile** no registo e login é um bom passo seguinte.
- **Authenticated Origin Pulls** (SSL/TLS → Origin Server): o nginx só aceita ligações que o Cloudflare assina. Garante que ninguém contorna o Cloudflare indo diretamente ao IP do servidor. Ativa-o no painel, descarrega o certificado de CA do Cloudflare para `infra/prod/nginx/cloudflare-origin-pull-ca.pem`, copia-o no `apps/web/Dockerfile` para `/etc/nginx/` e acrescenta `ssl_client_certificate /etc/nginx/cloudflare-origin-pull-ca.pem; ssl_verify_client on;` aos blocos `server` com `listen 443`.
- Na firewall da **Contabo** (painel): só 22 (idealmente só do teu IP), 80 e 443.

## 4. Preparar o servidor (uma vez)

```bash
# como root, ligando por chave SSH (depois desativa a senha)
adduser deploy && usermod -aG sudo deploy
apt update && apt -y upgrade && apt -y install ufw fail2ban unattended-upgrades git
# Docker (repositório oficial)
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
# SSH: só chave, sem root
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && systemctl restart ssh
# Firewall do sistema: SSH e web (o Docker publica 80/443 por conta própria, ver nota abaixo)
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80,443/tcp
ufw enable
```

> O Docker abre portas **por cima** do `ufw` (ignora as regras dele). Por isso, no `docker-compose.yml` só o nginx publica portas (80/443); PostgreSQL, Redis e a API nunca ficam expostos. Para restringir quem chega a 80/443 usa a firewall da Contabo e as Authenticated Origin Pulls do Cloudflare (secção 3), não o `ufw`.

## 5. Instalar e arrancar

```bash
su - deploy
git clone https://github.com/dombuque/txillapp.git && cd txillapp/infra/prod
cp .env.example .env && nano .env        # preencher TUDO (segredos fortes: ver comentários)
cp /caminho/cloudflare.ini certbot/cloudflare.ini && chmod 600 certbot/cloudflare.ini   # dns_cloudflare_api_token = ...
printf %s "$(grep ^METRICS_TOKEN= .env | cut -d= -f2-)" > monitoring/metrics_token

# 1.ª vez: emitir o certificado (o nginx precisa dele para arrancar). Depois renova sozinho.
docker compose run --rm --entrypoint certbot certbot certonly --dns-cloudflare \n  --dns-cloudflare-credentials /etc/cloudflare.ini --dns-cloudflare-propagation-seconds 40 \n  --cert-name txillapp.com -d app.txillapp.com -d api.txillapp.com -d admin.txillapp.com -d monitor.txillapp.com \n  --email admin@txillapp.com --agree-tos --no-eff-email

docker compose up -d --build              # nginx, certbot, api, migrate, postgres, redis, backup
docker compose logs -f api                # esperar "Nest application successfully started"
curl -I https://app.txillapp.com          # 200
```

Primeira conta de moderação (depois de te registares na app):

```bash
docker compose exec postgres psql -U txill -d txillapp -c "UPDATE identity.users SET is_admin = true WHERE username = 'o_teu_username';"
```

Monitorização e pesquisa (opcionais): `docker compose --profile monitoring up -d` (Grafana em `monitor.txillapp.com`, utilizador `admin`) e `--profile search up -d` + `SEARCH_BACKEND=elasticsearch` + `npm run search:reindex`.

## 6. Atualizar

```bash
cd ~/txillapp && git pull && cd infra/prod && docker compose up -d --build && docker image prune -f
```

As migrações correm sozinhas (`migrate`) antes de a API arrancar. As pessoas veem "Há uma versão nova 🎉" na app. Para reverter: `git checkout <commit-anterior>` e repetir (as migrações só avançam; escreve migrações compatíveis com a versão anterior).

## 7. Cópias de segurança

- **Base de dados**: todas as noites às 03:30 UTC, cifrada (age) e enviada para `BACKUP_BUCKET`. Guarda 35 dias + as de dia 1 de cada mês durante 13 meses.
- **Ficheiros**: no R2 já estão fora do servidor; ativa o *Object Versioning*/proteção no Cloudflare ou replica para B2 com `rclone sync` se quiseres uma segunda cópia. Se usares disco local, o `backup` copia-os aos domingos.
- **Testa o restauro** (uma cópia que nunca foi restaurada não é uma cópia). Num servidor de teste:

```bash
rclone copyto backup:txillapp-backups/postgres/2026/10/txillapp-XXXX.dump.age ./dump.age
age -d -i chave-privada.txt -o dump.dump dump.age
docker compose exec -T postgres createdb -U txill restore_test
docker compose exec -T postgres pg_restore -U txill -d restore_test --no-owner < dump.dump
```

- Alerta: define `HEALTHCHECK_URL` (healthchecks.io) e recebes aviso se uma noite falhar.

## 8. Antes de abrir ao público (checklist)

- [ ] Senhas e chaves novas em `.env` (nada reaproveitado do desenvolvimento) e `JWT_ACCESS_SECRET` único.
- [ ] `IMAGE_MODERATION=local` (o modelo descarrega no 1.º uso; testa uma foto).
- [ ] R2: bucket `txillapp-private` **sem** acesso público; `S3_PRIVATE_BUCKET` definido.
- [ ] Chaves VAPID de produção (`npx web-push generate-vapid-keys`) e teste de notificação num telemóvel.
- [ ] Google OAuth com a origem `https://app.txillapp.com`.
- [ ] **Recuperar senha por e-mail** (ainda não existe na app) e e-mail transacional configurado.
- [ ] Páginas legais revistas por um advogado e preenchidos os dados da entidade (`Legal.tsx`).
- [ ] CSP em modo de observação (`Content-Security-Policy-Report-Only`): verificar a consola e só depois passar a `Content-Security-Policy`.
- [ ] Restauro testado; alertas (healthchecks, Grafana) a funcionar.
- [ ] Teste de carga simples (k6/autocannon) contra o servidor para saber o limite.

## 9. Limites conhecidos (hoje)

- **Um só servidor**: o tempo real (chat) e os limites de pedidos guardam estado em memória. Para mais de uma instância da API é preciso usar o Redis para isso (já está no Compose, falta ligar).
- **Latência**: a Contabo não tem centro de dados em África. O Cloudflare ajuda com tudo o que é estático e com `media.`; a API responde de longe (ordem de 150–250 ms). Se a maioria dos utilizadores for moçambicana e a latência pesar, vale avaliar um servidor mais perto (África do Sul) mais tarde.
- **Vídeos**: converte-se no próprio servidor (uma conversão de cada vez); com muitos vídeos é preciso um servidor/fila à parte.
- **R2 testado só com um servidor S3 simulado**: faz um teste real (enviar foto, vídeo, mensagem com foto e apagar conta) antes de abrir.
