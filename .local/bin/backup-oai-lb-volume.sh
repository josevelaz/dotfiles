#!/usr/bin/env bash

set -e

VOLUME="codex-lb-data"
BACKUP_DIR="$HOME/docker-volume-backups"
DATE=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# Ensure we are using Colima
docker context use colima >/dev/null 2>&1

if docker run --rm \
  -v ${VOLUME}:/volume:ro \
  -v ${BACKUP_DIR}:/backup \
  alpine \
  sh -lc "tar czf /backup/${VOLUME}-${DATE}.tar.gz -C /volume ."
then
  # Only delete old backups if backup succeeded
  find "$BACKUP_DIR" -name "${VOLUME}-*.tar.gz" -mtime +3 -delete
else
  echo "Backup failed. Skipping cleanup."
fi
