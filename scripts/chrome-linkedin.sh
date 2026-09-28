#!/bin/bash
# LinkedIn uchun alohida Chrome oynasi.
#
# Bu oynani SIZ ochasiz va LinkedIn'ga O'ZINGIZ kirasiz. Agent faqat shu oyna
# ochiq turganda unda ishlay oladi. Oynani yopsangiz — kirishi tugaydi.
# Hermes'ga hech qanday parol yoki cookie berilmaydi.
#
# Nega alohida papka: Chrome 136+ asosiy profilda remote debugging'ni bloklaydi.
# Bu papka faqat shu maqsad uchun — asosiy profilingizga tegilmaydi.

PROFIL="$HOME/Desktop/Tezcode/Tezcode-Agents/.chrome-linkedin"
PORT=9222
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "Chrome topilmadi: $CHROME" >&2
  exit 1
fi

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
  echo "Oyna allaqachon ochiq (port $PORT)."
  exit 0
fi

mkdir -p "$PROFIL"
"$CHROME" \
  --user-data-dir="$PROFIL" \
  --remote-debugging-port=$PORT \
  --no-first-run \
  --no-default-browser-check \
  "https://www.linkedin.com/feed/" \
  > /dev/null 2>&1 &

echo "Chrome ochildi (port $PORT)."
echo "LinkedIn'ga kiring — sessiya shu papkada saqlanadi, keyingi safar qayta kirish shart emas."
