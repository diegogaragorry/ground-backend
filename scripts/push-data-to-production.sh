#!/usr/bin/env bash
# Sube los datos de la base local ground a la base de producción (Railway).
# ATENCIÓN: reemplaza TODOS los datos en producción con los de tu máquina local.
#
# Uso:
#   1. En Railway → tu proyecto → Postgres → Variables → copiá DATABASE_URL.
#   2. Ejecutá (reemplazá por la URL real de Railway):
#      PRODUCTION_DATABASE_URL="postgresql://postgres:xxx@containers.railway.app:5432/railway" ./scripts/push-data-to-production.sh
#
# Requiere: pg_dump y psql (p. ej. brew install postgresql@15).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

SOURCE_DATABASE_URL="${DATABASE_URL}"
DESTINATION_DATABASE_URL="${PRODUCTION_DATABASE_URL}"

if [ -z "$SOURCE_DATABASE_URL" ]; then
  echo "Error: DATABASE_URL no está en .env (base local)."
  exit 1
fi

if [ -z "$DESTINATION_DATABASE_URL" ]; then
  echo "Error: tenés que pasar la URL de la base de producción."
  echo ""
  echo "Uso:"
  echo "  PRODUCTION_DATABASE_URL=\"postgresql://...\" ./scripts/push-data-to-production.sh"
  echo ""
  echo "Obtené PRODUCTION_DATABASE_URL desde Railway → Postgres → Variables → DATABASE_URL"
  exit 1
fi

# Ocultar contraseña en el echo (mostrar solo user@host/db)
echo "Origen (local):  $SOURCE_DATABASE_URL"
echo "Destino (prod):  $DESTINATION_DATABASE_URL"
echo ""
echo "⚠️  Se van a REEMPLAZAR todos los datos en producción con los de tu base local."
read -p "¿Continuar? (escribí 'si' y Enter): " confirm
if [ "$confirm" != "si" ]; then
  echo "Cancelado."
  exit 0
fi

TABLES='"User","Category","Currency","Expense","Budget","Investment","InvestmentMovement","InvestmentSnapshot","Period","Income","ExpensePlan","MonthClose","ExpenseTemplate","PlannedExpense","MonthlyBudget","EmailVerificationCode"'
DUMP_FILE="${TMPDIR:-/tmp}/ground_push_prod_$$.sql"

echo ""
echo "1/3 Volcando datos desde la base local..."
pg_dump "$SOURCE_DATABASE_URL" --data-only --no-owner --no-privileges -f "$DUMP_FILE"

echo "2/3 Vaciando tablas en producción..."
psql "$DESTINATION_DATABASE_URL" -c "TRUNCATE $TABLES CASCADE;"

echo "3/3 Restaurando datos en producción..."
psql "$DESTINATION_DATABASE_URL" -f "$DUMP_FILE"

rm -f "$DUMP_FILE"
echo ""
echo "Listo. La base de producción tiene ahora los mismos datos que tu base local."
