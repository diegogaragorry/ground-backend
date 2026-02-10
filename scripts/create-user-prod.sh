#!/usr/bin/env bash
# Crear un usuario de prueba en la base de producción (categories, templates, bank account).
# Uso (usá COMILLAS SIMPLES para la URL para que el shell no corte en ? o &):
#   PRODUCTION_DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require' EMAIL=test@ejemplo.com PASSWORD=mipass123 ./scripts/create-user-prod.sh
# Si la contraseña de la DB tiene # ? & = o @, codificala en URL (ej. # → %23).
# Obtené la URL en Railway → proyecto → Postgres → Variables → DATABASE_URL.

set -e
cd "$(dirname "$0")/.."

if [ -z "$PRODUCTION_DATABASE_URL" ]; then
  echo "Falta PRODUCTION_DATABASE_URL."
  echo "Usá COMILLAS SIMPLES: PRODUCTION_DATABASE_URL='postgresql://...' EMAIL=... PASSWORD=... ./scripts/create-user-prod.sh"
  exit 1
fi

EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Faltan EMAIL y/o PASSWORD."
  echo "Uso: PRODUCTION_DATABASE_URL=\"postgresql://...\" EMAIL=tu@email.com PASSWORD=tucontraseña ./scripts/create-user-prod.sh"
  exit 1
fi

echo "Creando usuario en la base de PRODUCCIÓN: $EMAIL"
export DATABASE_URL="$PRODUCTION_DATABASE_URL"
export EMAIL PASSWORD
npx tsx scripts/create-user.ts
