#!/bin/sh
# Registos técnicos do servidor da Txillada (LiveKit, TURN, Caddy): no máximo 7 dias. Os contentores escrevem em json-file;
# os ficheiros com mais de 7 dias de conteúdo são esvaziados (o Docker continua a escrever no mesmo ficheiro).
find /var/lib/docker/containers -name "*-json.log*" -mtime +0 -newermt "-8 days" >/dev/null 2>&1
for f in /var/lib/docker/containers/*/*-json.log; do
  [ -f "$f" ] || continue
  first=$(head -c 400 "$f" | grep -o "\"time\":\"[0-9T:.-]*" | head -1 | cut -d\" -f4 | cut -c1-10)
  [ -n "$first" ] || continue
  age=$(( ( $(date +%s) - $(date -d "$first" +%s) ) / 86400 ))
  [ "$age" -ge 7 ] && truncate -s 0 "$f"
done
rm -f /var/lib/docker/containers/*/*-json.log.[0-9]* 2>/dev/null
journalctl --vacuum-time=7d >/dev/null 2>&1
exit 0
