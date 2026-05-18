# À sourcer depuis un script bash (pas d'exécution directe).
# Configure ANDROID_HOME et PATH pour adb / emulator (installation par défaut macOS).

_sdk=""
if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
  _sdk="$ANDROID_HOME"
elif [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
  _sdk="$ANDROID_HOME"
elif [[ -d "${HOME}/Library/Android/sdk" ]]; then
  export ANDROID_HOME="${HOME}/Library/Android/sdk"
  _sdk="$ANDROID_HOME"
fi

if [[ -n "${_sdk}" ]]; then
  export ANDROID_HOME="$_sdk"
  _pt="$_sdk/platform-tools"
  _emu="$_sdk/emulator"
  if [[ -d "$_pt" ]]; then
    case ":${PATH}:" in *":${_pt}:"*) ;; *) PATH="${_pt}:${PATH}" ;; esac
  fi
  if [[ -d "$_emu" ]]; then
    case ":${PATH}:" in *":${_emu}:"*) ;; *) PATH="${_emu}:${PATH}" ;; esac
  fi
  export PATH
fi
