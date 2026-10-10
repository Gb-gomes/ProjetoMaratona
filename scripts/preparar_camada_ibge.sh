#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Prepara a camada territorial do piloto a partir da malha OFICIAL do IBGE.
#
#   Malha de Setores Censitários — Censo 2022 — IBGE (arquivo por UF, Shapefile)
#   https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/
#     malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/
#
# Uso (Git Bash, Linux ou macOS), a partir da raiz do projeto:
#   scripts/preparar_camada_ibge.sh <UF> <CODIGO_MUNICIPIO_IBGE_7_DIGITOS> [CAMPO_MUNICIPIO]
#   ex.: scripts/preparar_camada_ibge.sh MT 5100000      (código fictício: use o real)
#
# O que faz:
#   1. Baixa o ZIP oficial da UF para scripts/ibge/raw/ (ignorado pelo git).
#   2. Registra o SHA-256, a URL e a data do download.
#   3. Lista campos e sistema de referência (ogrinfo) → scripts/ibge/raw/ogrinfo_<UF>.txt
#   4. Recorta SOMENTE o município indicado (filtro por atributo, sem alterar
#      geometrias), converte para EPSG:4326 e grava GeoJSON RFC 7946 em
#      public/data/ibge/camada_piloto.geojson. Nenhuma simplificação é aplicada.
#   5. Valida o resultado com scripts/inspecionar_camada.mjs.
#
# Requisitos: curl e GDAL (ogr2ogr/ogrinfo). Sem GDAL local, usa Docker com a
# imagem oficial ghcr.io/osgeo/gdal.
# -----------------------------------------------------------------------------
set -euo pipefail
# Git Bash (Windows): impede a conversão automática de caminhos como /vsizip/.
export MSYS_NO_PATHCONV=1

UF="${1:?Informe a UF (ex.: MT)}"
CD_MUN="${2:?Informe o código IBGE do município (7 dígitos)}"
CAMPO_MUN="${3:-CD_MUN}"
UF="$(echo "$UF" | tr '[:lower:]' '[:upper:]')"

if ! [[ "$CD_MUN" =~ ^[0-9]{7}$ ]]; then
  echo "Código de município inválido: '$CD_MUN' (esperado: 7 dígitos)." >&2
  exit 1
fi

BASE="https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF"
ARQ="${UF}_setores_CD2022.zip"
URL="${BASE}/${ARQ}"
RAW="scripts/ibge/raw"
OUT="public/data/ibge/camada_piloto.geojson"
ORIGEM="public/data/ibge/camada_piloto.origem.json"
mkdir -p "$RAW" "$(dirname "$OUT")"

# GDAL local ou via Docker
if command -v ogr2ogr >/dev/null 2>&1; then
  OGR2OGR=(ogr2ogr); OGRINFO=(ogrinfo)
elif command -v docker >/dev/null 2>&1; then
  IMG="ghcr.io/osgeo/gdal:ubuntu-small-3.9.2"
  HOSTDIR="$(pwd -W 2>/dev/null || pwd)"
  DOCKER=(docker run --rm -v "${HOSTDIR}:/w" -w /w "$IMG")
  OGR2OGR=("${DOCKER[@]}" ogr2ogr); OGRINFO=("${DOCKER[@]}" ogrinfo)
  echo "GDAL local não encontrado; usando Docker ($IMG)."
else
  echo "GDAL não encontrado. Instale o QGIS/OSGeo4W (inclui ogr2ogr) ou o Docker." >&2
  exit 1
fi

if [ ! -f "$RAW/$ARQ" ]; then
  echo "Baixando $URL"
  curl -fL --retry 3 -o "$RAW/$ARQ.part" "$URL"
  mv "$RAW/$ARQ.part" "$RAW/$ARQ"
else
  echo "Usando arquivo já baixado: $RAW/$ARQ"
fi

SHA256="$(sha256sum "$RAW/$ARQ" | cut -d' ' -f1)"
DATA_DOWNLOAD="$(date -r "$RAW/$ARQ" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)"

echo "Inspecionando campos e sistema de referência…"
"${OGRINFO[@]}" -so -al "/vsizip/$RAW/$ARQ" > "$RAW/ogrinfo_${UF}.txt"
grep -E "Layer name|Geometry|Feature Count|GEOGCRS|DATUM|ID\[\"EPSG|^[A-Z_0-9]+: " "$RAW/ogrinfo_${UF}.txt" | head -60 || true

if ! grep -q "^${CAMPO_MUN}: " "$RAW/ogrinfo_${UF}.txt"; then
  echo "Campo '${CAMPO_MUN}' não encontrado na malha. Veja $RAW/ogrinfo_${UF}.txt e informe o campo correto." >&2
  exit 1
fi

echo "Recortando ${CAMPO_MUN} = ${CD_MUN} e convertendo para EPSG:4326…"
rm -f "$OUT"
"${OGR2OGR[@]}" -f GeoJSON "$OUT" "/vsizip/$RAW/$ARQ" \
  -where "${CAMPO_MUN} = '${CD_MUN}'" \
  -t_srs EPSG:4326 \
  -makevalid \
  -lco RFC7946=YES \
  -lco COORDINATE_PRECISION=7

GDAL_VERSAO="$("${OGR2OGR[@]}" --version | head -1)"
cat > "$ORIGEM" <<JSON
{
  "fonte": "IBGE — Malha de Setores Censitários — Censo 2022",
  "url": "$URL",
  "arquivo": "$ARQ",
  "sha256": "$SHA256",
  "dataObtencao": "$DATA_DOWNLOAD",
  "uf": "$UF",
  "filtro": "${CAMPO_MUN} = '${CD_MUN}'",
  "conversao": "ogr2ogr -t_srs EPSG:4326 -makevalid -lco RFC7946=YES -lco COORDINATE_PRECISION=7 (sem simplificação)",
  "gdal": "$GDAL_VERSAO",
  "geradoEm": "$(date +%Y-%m-%dT%H:%M:%S%z)"
}
JSON

echo "Validando a camada gerada…"
node scripts/inspecionar_camada.mjs "$OUT" CD_SETOR

cat <<MSG

Camada gerada: $OUT
Origem registrada: $ORIGEM

Próximos passos (docs/CAMADA_TERRITORIAL.md):
  1. Confira em $RAW/ogrinfo_${UF}.txt o CRS de origem e os nomes dos campos.
  2. Atualize PILOT_CONFIG em src/config.js (território, obtainedOn = $DATA_DOWNLOAD,
     status = 'official-unvalidated').
  3. Confira visualmente a camada no QGIS e registre a validação antes de
     mudar o status para 'official-validated'.
MSG
