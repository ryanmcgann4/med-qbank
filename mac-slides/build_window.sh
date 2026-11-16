#!/bin/zsh
# Builds the two windows into ~/Applications:
#  - Q-Bank Questions.app, which "Make Q-Bank Questions" opens to choose lectures, files, number of
#    questions, style and Library folder (QBankQuestions.swift)
#  - Q-Bank Filing.app, the "File Lectures" window for lecture files the organizer couldn't place
#    (QBankFiling.swift, with filing.py and what it needs in Resources)
# Needs swiftc (Xcode or the Command Line Tools: xcode-select --install). Without it, the Quick
# Action still works, using your last settings and no window, and unplaced files get a notification.
set -e
DIR=${0:A:h}
if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found (xcode-select --install); Make Q-Bank Questions and the organizer will run without their windows."
  exit 0
fi

# build <source name> <app name> <bundle id> [files for Resources…]
build() {
  local src=$1 name=$2 id=$3
  shift 3
  local app="$HOME/Applications/$name.app" tmp=$(mktemp -d)
  swiftc -parse-as-library -O "$DIR/$src.swift" -o "$tmp/$src"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  mv "$tmp/$src" "$app/Contents/MacOS/"
  rm -rf "$tmp"
  for f in "$@"; do cp "$DIR/$f" "$app/Contents/Resources/"; done
  /usr/bin/python3 - "$app/Contents/Info.plist" "$src" "$name" "$id" <<'PY'
import plistlib, sys
path, exe, name, ident = sys.argv[1:]
plistlib.dump({
    "CFBundleExecutable": exe,
    "CFBundleIdentifier": ident,
    "CFBundleName": name,
    "CFBundleDisplayName": name,
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": "1.0",
    "CFBundleVersion": "1",
    "LSMinimumSystemVersion": "13.0",
    "NSHighResolutionCapable": True,
}, open(path, "wb"))
PY
  codesign --force --sign - "$app" >/dev/null 2>&1
  echo "Built $app"
}

build QBankQuestions "Q-Bank Questions" local.qbank.questions
build QBankFiling "Q-Bank Filing" local.qbank.filing filing.py organize.py common.py
