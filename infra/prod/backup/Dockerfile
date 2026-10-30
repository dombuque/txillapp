FROM postgres:17-alpine
# pg_dump (já vem na imagem do Postgres) + rclone (envio) + age (cifra). Corre todas as noites às 03:30 UTC.
RUN apk add --no-cache rclone age tzdata curl
COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
