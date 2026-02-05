#!/usr/bin/env bash
# Importa datos desde la base del proyecto expense-tracker-backend a la base local ground.
# Uso: desde ground-backend ejecutá ./scripts/import-from-expense-tracker.sh
# O pasá la URL de origen: SOURCE_DATABASE_URL="postgresql://..." ./scripts/import-from-expense-tracker.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

# Cargar .env del backend actual (destino = ground)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Origen: por defecto la base del proyecto viejo (ajustá si usás otro usuario/DB)
SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-postgresql://diegogaragorry@localhost:5432/expense_tracker}"
DESTINATION_DATABASE_URL="${DATABASE_URL}"

if [ -z "$DESTINATION_DATABASE_URL" ]; then
  echo "Error: DATABASE_URL no está definido en ground-backend/.env"
  exit 1
fi

echo "Origen:      $SOURCE_DATABASE_URL"
echo "Destino:     $DESTINATION_DATABASE_URL"
echo ""

# Tablas en el mismo orden que Prisma (para TRUNCATE CASCADE)
TABLES='"User","Category","Currency","Expense","Budget","Investment","InvestmentMovement","InvestmentSnapshot","Period","Income","ExpensePlan","MonthClose","ExpenseTemplate","PlannedExpense","MonthlyBudget","EmailVerificationCode"'

DUMP_FILE="${TMPDIR:-/tmp}/ground_import_$$.sql"

echo "1/3 Volcando datos desde la base origen..."
pg_dump "$SOURCE_DATABASE_URL" --data-only --no-owner --no-privileges -f "$DUMP_FILE"

echo "2/3 Vaciendo tablas en la base destino..."
psql "$DESTINATION_DATABASE_URL" -c "TRUNCATE $TABLES CASCADE;"

echo "3/3 Restaurando datos en ground..."
psql "$DESTINATION_DATABASE_URL" -f "$DUMP_FILE"

rm -f "$DUMP_FILE"
echo "Listo. La base ground tiene ahora los datos de expense_tracker."
echo "Reiniciá el backend (npm run dev) y entrá con el mismo usuario que usabas antes."
