#!/bin/zsh
# Builds "Q-Bank Slides.app" in ~/Applications and registers it for qbank-slides:// links,
# so Q-Bank's "Open slide" button opens the lecture file on this Mac.
#   ./install.sh "/path/to/Block 2" "Block 2"     # course folder, and its course name in Q-Bank
set -e
DIR=${0:A:h}
APP="$HOME/Applications/Q-Bank Slides.app"
SUPPORT="$HOME/Library/Application Support/Q-Bank Slides"

mkdir -p "$HOME/Applications" "$SUPPORT"
rm -rf "$APP"
SCRIPT=$(mktemp -t qbank-slides).applescript
cat > "$SCRIPT" <<'AS'
on open location theURL
	do shell script "/usr/bin/python3 " & quoted form of (POSIX path of (path to me) & "Contents/Resources/open_slide.py") & " " & quoted form of theURL
end open location

on run
	display dialog "Q-Bank Slides opens lecture slides when you click “Open slide” in Q-Bank. Nothing to do here." buttons {"OK"} default button 1 with title "Q-Bank Slides"
end run
AS
osacompile -o "$APP" "$SCRIPT"
rm -f "$SCRIPT"
cp "$DIR/open_slide.py" "$APP/Contents/Resources/"
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "local.qbank.slides" "$PLIST"
plutil -replace CFBundleName -string "Q-Bank Slides" "$PLIST"
plutil -replace LSUIElement -bool true "$PLIST"
plutil -replace CFBundleURLTypes -json '[{"CFBundleURLName":"Q-Bank Slides","CFBundleURLSchemes":["qbank-slides"]}]' "$PLIST"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

if [[ -n "$1" ]]; then
  COURSE=${2:-$(basename "$1")}
  /usr/bin/python3 - "$SUPPORT/config.json" "$COURSE" "$1" <<'PY'
import json, sys, os
path, course, root = sys.argv[1:]
cfg = json.load(open(path)) if os.path.exists(path) else {}
cfg.setdefault("courses", {})[course] = os.path.abspath(root)
json.dump(cfg, open(path, "w"), indent=1)
PY
fi
echo "Installed $APP"
