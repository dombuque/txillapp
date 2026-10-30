#!/bin/sh
# Cópia de segurança cifrada: db = base de dados (pg_dump); files = ficheiros em disco (só se STORAGE_DRIVER=local).
# Cifra com a chave PÚBLICA (age): quem rouba a cópia não a lê; só quem tem a chave privada (guardada fora do servidor).
# Teste de restauro: docs/DEPLOY.md, secção "Restaurar".
set -eu

MODE="${1:-db}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MONTH="$(date -u +%Y/%m)"

# rclone configurado só por variáveis de ambiente (nada de ficheiros com segredos)
export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_BACKUP_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_BACKUP_ACL=private
export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

ping() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}${1:-}" >/dev/null 2>&1 || true; }
ping /start

fail() { echo "[backup] FALHOU: $1" >&2; ping /fail; exit 1; }

case "$MODE" in
  db)
    OUT="/tmp/txillapp-$STAMP.dump"
    echo "[backup] pg_dump…"
    pg_dump "$DATABASE_URL" --format=custom --compress=6 --file "$OUT" || fail "pg_dump"
    age -r "$AGE_PUBLIC_KEY" -o "$OUT.age" "$OUT" || fail "cifra"
    SIZE="$(wc -c < "$OUT.age")"
    [ "$SIZE" -gt 1024 ] || fail "ficheiro demasiado pequeno ($SIZE bytes)"
    rclone copyto "$OUT.age" "backup:${BACKUP_BUCKET}/postgres/${MONTH}/txillapp-$STAMP.dump.age" || fail "envio"
    rm -f "$OUT" "$OUT.age"
    # Retenção: tudo durante 35 dias; os de dia 1 de cada mês durante 13 meses.
    rclone delete "backup:${BACKUP_BUCKET}/postgres" --min-age 35d --exclude "txillapp-??????01T*" || true
    rclone delete "backup:${BACKUP_BUCKET}/postgres" --min-age 400d || true
    echo "[backup] base de dados guardada ($SIZE bytes)"
    ;;
  files)
    if [ ! -d /data/uploads ] || [ -z "$(ls -A /data/uploads 2>/dev/null)" ]; then echo "[backup] sem ficheiros em disco, nada a fazer"; ping; exit 0; fi
    echo "[backup] ficheiros…"
    # Sincroniza sem apagar no destino (um apagão acidental no servidor não apaga a cópia).
    rclone copy /data/uploads "backup:${BACKUP_BUCKET}/uploads" --transfers 4 --ignore-existing || fail "ficheiros"
    echo "[backup] ficheiros guardados"
    ;;
  *) fail "modo desconhecido: $MODE" ;;
esac

ping
