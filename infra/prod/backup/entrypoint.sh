#!/bin/sh
# Arranca o agendador: cópia da base de dados todas as noites às 03:30 UTC e dos ficheiros (se estiverem no disco) aos domingos.
set -eu
: "${AGE_PUBLIC_KEY:?AGE_PUBLIC_KEY em falta (chave pública age)}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET em falta}"
echo "30 3 * * * /usr/local/bin/backup.sh db   >> /proc/1/fd/1 2>&1" >  /etc/crontabs/root
echo "50 3 * * 0 /usr/local/bin/backup.sh files >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
echo "[backup] agendado: base de dados 03:30 UTC (diário), ficheiros 03:50 UTC (domingos)"
exec crond -f -l 8
