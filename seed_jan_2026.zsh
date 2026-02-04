#!/bin/zsh
set -euo pipefail

: "${BASE:?Set BASE first}"
: "${TOKEN:?Set TOKEN first}"

FX="37.983"
DATE="2026-01-01"

auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# map categories by name -> id
echo "---- Loading categories ----"
CATS_JSON="$(curl -s "$BASE/categories" -H "Authorization: Bearer $TOKEN")"
python3 - <<'PY' "$CATS_JSON"
import json, sys
cats=json.loads(sys.argv[1])
m={c["name"]: c["id"] for c in cats}
need=["Cuentas","Auto","Nafta","Transporte","Comida","Salud","Salidas","Simo","Casa","Ropa","Regalos","Otros"]
missing=[n for n in need if n not in m]
if missing:
  raise SystemExit("Missing categories: "+", ".join(missing))
print("OK")
PY

cat_id () {
  python3 - <<PY "$CATS_JSON" "$1"
import json, sys
cats=json.loads(sys.argv[1]); name=sys.argv[2]
for c in cats:
  if c["name"]==name:
    print(c["id"]); raise SystemExit
raise SystemExit("Category not found: "+name)
PY
}

post_expense () {
  local desc="$1"
  local amount="$2"
  local cur="$3"
  local cat="$4"
  local rate="${5:-}"

  # amount must be positive for backend
  if [[ "$amount" == -* ]]; then amount="${amount#-}"; fi

  local payload
  if [[ "$cur" == "UYU" ]]; then
    payload=$(python3 - <<PY "$desc" "$amount" "$cur" "$cat" "$DATE" "$rate"
import json,sys
desc,amount,cur,cat,date,rate=sys.argv[1:]
print(json.dumps({
  "description": desc,
  "amount": float(amount),
  "currencyId": cur,
  "usdUyuRate": float(rate),
  "categoryId": cat,
  "date": date
}))
PY
)
  else
    payload=$(python3 - <<PY "$desc" "$amount" "$cur" "$cat" "$DATE"
import json,sys
desc,amount,cur,cat,date=sys.argv[1:]
print(json.dumps({
  "description": desc,
  "amount": float(amount),
  "currencyId": cur,
  "categoryId": cat,
  "date": date
}))
PY
)
  fi

  # execute and validate
  local code
  code=$(curl -s -o /tmp/seed_resp.json -w "%{http_code}" \
    "$BASE/expenses" "${auth[@]}" \
    -d "$payload")

  if [[ "$code" != "201" ]]; then
    echo "❌ Failed ($code) creating: $desc"
    cat /tmp/seed_resp.json; echo
    exit 1
  fi
}

CAT_CUENTAS="$(cat_id Cuentas)"
CAT_AUTO="$(cat_id Auto)"
CAT_NAFTA="$(cat_id Nafta)"
CAT_TRANSPORTE="$(cat_id Transporte)"
CAT_COMIDA="$(cat_id Comida)"
CAT_SALUD="$(cat_id Salud)"
CAT_SALIDAS="$(cat_id Salidas)"
CAT_SIMO="$(cat_id Simo)"
CAT_CASA="$(cat_id Casa)"
CAT_ROPA="$(cat_id Ropa)"
CAT_REGALOS="$(cat_id Regalos)"
CAT_OTROS="$(cat_id Otros)"

echo "---- Inserting expenses for Jan 2026 ----"

# Cuentas
post_expense "Pensión Simo" 12991 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Pensión Simo - Sueldo Guada" 7392 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Alquiler Sosa233" 1906 "USD" "$CAT_CUENTAS"
post_expense "Gastos Comunes" 19799 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Sueldo Andrea" 6178 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "BPS Andrea" 4223 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Salario Vacacional Andrea" 7150 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "ADSL" 1707 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "ANTEL Móvil" 678 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "UTE" 2106 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Montevideo Gas" 1091 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "MP" 22206 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Spotify" 15 "USD" "$CAT_CUENTAS"
post_expense "iCloud" 3 "USD" "$CAT_CUENTAS"
post_expense "Viaaqua" 3722 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Surf" 2000 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "CJPPU" 8084 "UYU" "$CAT_CUENTAS" "$FX"
post_expense "Peluquería" 500 "UYU" "$CAT_CUENTAS" "$FX"
# (los que eran $0 o vacíos los omitimos)

# Auto / Nafta / Transporte
post_expense "Patente" 57996 "UYU" "$CAT_AUTO" "$FX"
post_expense "Nafta" 10977 "UYU" "$CAT_NAFTA" "$FX"
post_expense "Bus interdep" 2820 "UYU" "$CAT_TRANSPORTE" "$FX"
post_expense "Taxis" 1200 "UYU" "$CAT_TRANSPORTE" "$FX"

# Comida
post_expense "Super" 10800 "UYU" "$CAT_COMIDA" "$FX"
post_expense "Delivery/Cafetería/Almuerzos" 3000 "UYU" "$CAT_COMIDA" "$FX"

# Salud
post_expense "Farmacia" 1500 "UYU" "$CAT_SALUD" "$FX"

# Salidas
post_expense "Peajes" 3638 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "Restaurants" 16300 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "DinoAventura mono lau" 1000 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "Escalada Charrúa" 1000 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "Santa Teresa" 2500 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "Lona Camping" 990 "UYU" "$CAT_SALIDAS" "$FX"
post_expense "Comidas BAIRES OASIS pagos hermanos" 4384 "UYU" "$CAT_SALIDAS" "$FX"

# Regalos
post_expense "Otros Navidad" 4400 "UYU" "$CAT_REGALOS" "$FX"
post_expense "Rifas Agus Carreto" 3000 "UYU" "$CAT_REGALOS" "$FX"
post_expense "Libros reyes sobrinos" 2500 "UYU" "$CAT_REGALOS" "$FX"
post_expense "Navidad Nane" 3995 "UYU" "$CAT_REGALOS" "$FX"

# Otros
post_expense "Programa SoySantander" 10268 "UYU" "$CAT_OTROS" "$FX"
post_expense "Cumple" 18500 "UYU" "$CAT_OTROS" "$FX"
post_expense "Cuota anual Itaú" 1670 "UYU" "$CAT_OTROS" "$FX"
post_expense "Ajuste para cierre" 2 "USD" "$CAT_OTROS"

echo "✅ Done."
echo "Verificación:"
curl -s "$BASE/expenses?year=2026&month=1" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -n 20
echo
curl -s "$BASE/expenses/summary?year=2026&month=1" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
