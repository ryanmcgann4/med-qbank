#!/bin/zsh
# Builds ~/Applications/Q-Bank Questions.app, the window "Make Q-Bank Questions" opens to choose
# lectures, files, number of questions, style and Library folder (QBankQuestions.swift).
# Needs swiftc (Xcode or the Command Line Tools: xcode-select --install). Without it, the Quick
# Action still works, using your last settings and no window.
set -e
DIR=${0:A:h}
APP="$HOME/Applications/Q-Bank Questions.app"
if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found (xcode-select --install); Make Q-Bank Questions will run without its window."
  exit 0
fi
TMP=$(mktemp -d)
swiftc -parse-as-library -O "$DIR/QBankQuestions.swift" -o "$TMP/QBankQuestions"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$TMP/QBankQuestions" "$APP/Contents/MacOS/"
rm -rf "$TMP"
/usr/bin/python3 - "$APP/Contents/Info.plist" <<'PY'
import plistlib, sys
plistlib.dump({
    "CFBundleExecutable": "QBankQuestions",
    "CFBundleIdentifier": "local.qbank.questions",
    "CFBundleName": "Q-Bank Questions",
    "CFBundleDisplayName": "Q-Bank Questions",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": "1.0",
    "CFBundleVersion": "1",
    "LSMinimumSystemVersion": "13.0",
    "NSHighResolutionCapable": True,
}, open(sys.argv[1], "wb"))
PY
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "Built $APP"
