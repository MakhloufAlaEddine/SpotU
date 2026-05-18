#!/usr/bin/env bash
# Échoue avec un message explicite si aucun appareil / émulateur Android n'est prêt pour adb.
set -euo pipefail
_script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
[[ -f "${_script_dir}/android-env.sh" ]] && source "${_script_dir}/android-env.sh"

if ! command -v adb &>/dev/null; then
  echo "" >&2
  echo "SpotU (Android) : \`adb\` est introuvable dans le PATH." >&2
  echo "  → Installe Android Studio, puis ajoute par exemple :" >&2
  echo "      export ANDROID_HOME=\"\$HOME/Library/Android/sdk\"" >&2
  echo "      export PATH=\"\$PATH:\$ANDROID_HOME/platform-tools\"" >&2
  echo "  (à mettre dans ~/.zshrc), ouvre un nouveau terminal et réessaie." >&2
  echo "" >&2
  exit 1
fi

# Lignes du type « serial<TAB>device » (hors « offline » / « unauthorized »).
if adb devices 2>/dev/null | awk 'BEGIN{f=0} NR>1 && NF>=2 && $2=="device"{f=1} END{exit f?0:1}'; then
  exit 0
fi

echo "" >&2
echo "SpotU (Android) : aucun appareil prêt (adb ne voit aucun « device »)." >&2
echo "" >&2
echo "  1) Lance un émulateur : Android Studio → Device Manager → ▶ sur un AVD." >&2
echo "     Ou en ligne de commande (remplace NOM_AVD) :" >&2
echo "        \"\$ANDROID_HOME/emulator/emulator\" -avd NOM_AVD" >&2
echo "" >&2
echo "  2) Ou branche un téléphone avec le débogage USB activé." >&2
echo "" >&2
echo "  3) Vérifie avec :  adb devices" >&2
echo "" >&2
exit 1
