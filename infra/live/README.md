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
