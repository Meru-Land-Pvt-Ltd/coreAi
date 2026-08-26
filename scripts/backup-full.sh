#!/usr/bin/env bash
#
# THE FOUNDER'S BACKUP — one command, one restorable archive, one tested link.
#
# Built 2026-08-26 after the first one took an hour of fumbling. It takes about
# two minutes now, and it makes exactly the file that rebuilds this platform on
# a bare server: the code, the whole database WITH its data, every env file, the
# master key that decrypts stored credentials, and a restore guide.
#
# The master key is the part people forget. A backup holding the database but
# not ENCRYPTION_KEY restores an app that starts, looks fine, and cannot send a
# single email or call a single API — every stored credential is noise without
# it. It is included on purpose.
#
#   bash scripts/backup-full.sh          → build + verify + serve, print the link
#   bash scripts/backup-full.sh --clean  → delete the served file and the archive
#
set -euo pipefail

WORK=/root/backup-work
SERVE=/srv/triven-dl
NGINX_CONF=/etc/nginx/sites-available/coreai.conf
DB_CONTAINER=coreai-postgres
DB_USER=coreai
DB_NAME=coreai

# ---------------------------------------------------------------- the cleanup
if [[ "${1:-}" == "--clean" ]]; then
  rm -f "$SERVE"/*.tar.gz 2>/dev/null || true
  rm -rf "$WORK"/staging "$WORK"/*.tar.gz 2>/dev/null || true
  # Take the download route back out of nginx so the path stops existing.
  if grep -q "TEMPORARY founder backup download" "$NGINX_CONF" 2>/dev/null; then
    perl -0pi -e 's/\n    # TEMPORARY founder backup download.*?\n    \}\n//s' "$NGINX_CONF"
    systemctl reload nginx
  fi
  echo "Both copies deleted. The link is dead."
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
rm -rf "$WORK/staging"
mkdir -p "$WORK/staging/env" "$SERVE"

# 1 ---------------------------------------------------------------- the source
# Everything the app needs, nothing it can rebuild. The excludes are by NAME,
# not by path: nested node_modules under apps/* slipped past path-shaped
# excludes on the first run and made a 632 MB archive out of a 31 MB one.
echo "==> Source"
tar -czf "$WORK/staging/source.tar.gz" -C /root \
  --exclude='node_modules' --exclude='.next' --exclude='dist' --exclude='build' \
  --exclude='.git' --exclude='backup-work' --exclude='tmp' \
  coreAi 2>/dev/null

# 2 -------------------------------------------------------------- the database
echo "==> Database"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$WORK/staging/database.sql.gz"
gzip -t "$WORK/staging/database.sql.gz"

# 3 ------------------------------------------------------- the env + the key
# Paths are flattened with __ so a single folder holds files from three levels;
# RESTORE.md says how to put each one back.
echo "==> Environment files"
while IFS= read -r f; do
  dest="coreAi__$(echo "${f#/root/coreAi/}" | tr '/' '_' | sed 's/_/__/g')"
  cp "$f" "$WORK/staging/env/$dest"
done < <(find /root/coreAi -name ".env*" -not -path "*/node_modules/*" | grep -vE '\.example$')

if ! grep -lq "^ENCRYPTION_KEY=" "$WORK"/staging/env/* 2>/dev/null; then
  echo "REFUSING: no ENCRYPTION_KEY found in any env file — this backup would restore a dead app."
  exit 1
fi

# 4 --------------------------------------------------------- the restore guide
cp /root/coreAi/docs/RESTORE-TEMPLATE.md "$WORK/staging/RESTORE.md" 2>/dev/null || cat > "$WORK/staging/RESTORE.md" <<'GUIDE'
# RESTORING TRIVEN

1. Install Docker, Docker Compose, Node 20+, git on the new machine.
2. `cd /root && tar -xzf source.tar.gz`            (creates /root/coreAi)
3. Put each file in `env/` back: the `__` in its name were `/`.
   e.g. coreAi__apps__backend__.env.production -> /root/coreAi/apps/backend/.env.production
4. `cd /root/coreAi && docker compose -f docker-compose.prod.yml up -d postgres redis`
5. `gunzip -c database.sql.gz | docker exec -i coreai-postgres psql -U coreai coreai`
6. `npm install && npm --workspace packages/shared run build`
7. `bash scripts/deploy-prod.sh`
8. Restore the nginx site config and point the domain.

CHECK IT WORKED: sign in, open an agent, send a test email. If mail sends, the
master key (ENCRYPTION_KEY, in the backend env file) restored correctly.

Business documents are stored inside the database, so they return with the dump.
There is no separate uploads folder.
GUIDE

# 5 --------------------------------------------------------------- seal + serve
echo "==> Sealing"
ARCHIVE="triven-full-$TS.tar.gz"
tar -czf "$WORK/$ARCHIVE" -C "$WORK/staging" .

# An unguessable name: the path IS the password, so it must not be a date or a
# word. Served by an exact-match nginx location — no directory listing exists.
SECRET="$(openssl rand -hex 24).tar.gz"
rm -f "$SERVE"/*.tar.gz
cp "$WORK/$ARCHIVE" "$SERVE/$SECRET"
chmod 644 "$SERVE/$SECRET"

if grep -q "TEMPORARY founder backup download" "$NGINX_CONF"; then
  perl -0pi -e 's/\n    # TEMPORARY founder backup download.*?\n    \}\n//s' "$NGINX_CONF"
fi
perl -0pi -e 's|(\n    location / \{)|"\n    # TEMPORARY founder backup download. One file, one unguessable path,\n    # removed by --clean the moment the founder confirms the download.\n    location = /dl/'"$SECRET"' {\n        alias '"$SERVE/$SECRET"';\n        add_header Content-Disposition '"'"'attachment; filename=\"'"$ARCHIVE"'\"'"'"';\n        add_header X-Robots-Tag \"noindex, nofollow\" always;\n        default_type application/gzip;\n    }\n" . $1|e' "$NGINX_CONF"
nginx -t >/dev/null 2>&1 && systemctl reload nginx

# 6 ------------------------------------------------------------- the verifying
# A link nobody tested is a link that fails at 2am. 206 proves range requests
# work, which is what a browser's download manager actually uses.
URL="https://triven.ai/dl/$SECRET"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" "$URL")

echo ""
echo "================= BACKUP READY ================="
echo "Link      : $URL"
echo "Size      : $(du -h "$WORK/$ARCHIVE" | cut -f1)"
echo "Covers    : $TS"
echo "Files     : $(tar -tzf "$WORK/$ARCHIVE" | wc -l) top-level, $(tar -xzOf "$WORK/$ARCHIVE" ./source.tar.gz | tar -tz | wc -l) source files"
echo "Database  : $(du -h "$WORK/staging/database.sql.gz" | cut -f1) (integrity verified)"
echo "Env files : $(ls "$WORK/staging/env" | wc -l) (ENCRYPTION_KEY confirmed present)"
echo "Range test: HTTP $CODE $([ "$CODE" = "206" ] && echo '(good)' || echo '(EXPECTED 206 — check nginx)')"
echo "================================================"
echo "After downloading: bash scripts/backup-full.sh --clean"
