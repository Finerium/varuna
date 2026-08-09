#!/bin/bash
# Tukar kredensial CDSE menjadi refresh token; password tidak pernah menyentuh disk/chat.
# Dijalankan MANUAL oleh operator: ! bash ~/Documents/Datathon/varuna/scripts/cdse-login.sh
set -euo pipefail
EMAIL="ghaisan.khoirul.b@gmail.com"
OUT="$HOME/Documents/Datathon/secrets/cdse-refresh-token"
read -r -s -p "Password CDSE untuk $EMAIL: " PW; echo
RESP=$(python3 - "$EMAIL" "$PW" <<'PY'
import sys, json, urllib.request, urllib.parse
email, pw = sys.argv[1], sys.argv[2]
data = urllib.parse.urlencode({
    "grant_type": "password", "username": email, "password": pw,
    "client_id": "cdse-public",
}).encode()
req = urllib.request.Request(
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    data=data, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=30) as f:
    tok = json.load(f)
print(tok.get("refresh_token", ""))
PY
)
if [ -z "$RESP" ]; then echo "GAGAL: token kosong (password salah / akun belum diverifikasi?)"; exit 1; fi
umask 077; printf '%s' "$RESP" > "$OUT"; chmod 600 "$OUT"
echo "OK: refresh token tersimpan di $OUT ($(wc -c < "$OUT") bytes)"
