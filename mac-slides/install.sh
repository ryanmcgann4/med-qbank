#!/bin/zsh
# Sets up the Q-Bank helpers on this Mac:
#  - "Q-Bank Slides.app" in ~/Applications, registered for qbank-slides:// links, so Q-Bank's
#    "Open slides" button opens the lecture file at its slide
#  - a LaunchAgent that files new lecture downloads into Week N/<n Day>/<Lecture>/ (needs schedule.json,
#    from parse_schedule.py)
#  - a Finder Quick Action, "Make Q-Bank Questions", for lecture and day folders
#  - the qbank-generator skill, linked into ~/.claude/skills for Claude Code
#   ./install.sh "/path/to/Block 2" "Block 2" owner/qbank-data   # course folder, its name in Q-Bank, your sync repo
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
cp "$DIR"/open_slide.py "$DIR"/common.py "$DIR"/file_downloads.py "$APP/Contents/Resources/"
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "local.qbank.slides" "$PLIST"
plutil -replace CFBundleName -string "Q-Bank Slides" "$PLIST"
plutil -replace LSUIElement -bool true "$PLIST"
plutil -replace CFBundleURLTypes -json '[{"CFBundleURLName":"Q-Bank Slides","CFBundleURLSchemes":["qbank-slides"]}]' "$PLIST"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

if [[ -n "$1" ]]; then
  COURSE=${2:-$(basename "$1")}
  /usr/bin/python3 - "$SUPPORT/config.json" "$COURSE" "$1" "$3" <<'PY'
import json, sys, os
path, course, root, repo = sys.argv[1:]
cfg = json.load(open(path)) if os.path.exists(path) else {}
cfg.setdefault("courses", {})[course] = os.path.abspath(root)
if repo:
    cfg["syncRepo"] = repo
json.dump(cfg, open(path, "w"), indent=1)
PY
fi
echo "Installed $APP"

# Watch Downloads: any change opens qbank-slides://file-downloads, which the app handles
# (as an app, it's what macOS asks you about for Downloads access).
AGENT="$HOME/Library/LaunchAgents/local.qbank.file-downloads.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$AGENT" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.qbank.file-downloads</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>qbank-slides://file-downloads</string></array>
  <key>WatchPaths</key><array><string>$HOME/Downloads</string></array>
  <key>ThrottleInterval</key><integer>5</integer>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "Watching ~/Downloads for lecture files"

# Finder → right-click a folder → Quick Actions → Make Q-Bank Questions.
WF="$HOME/Library/Services/Make Q-Bank Questions.workflow"
rm -rf "$WF"
mkdir -p "$WF/Contents"
cat > "$WF/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSIconName</key><string>NSActionTemplate</string>
      <key>NSMenuItem</key><dict><key>default</key><string>Make Q-Bank Questions</string></dict>
      <key>NSMessage</key><string>runWorkflowAsService</string>
      <key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
      <key>NSSendFileTypes</key><array><string>public.folder</string></array>
    </dict>
  </array>
</dict>
</plist>
PL
/usr/bin/python3 - "$WF/Contents/document.wflow" "$DIR/make_questions.py" <<'PY'
import plistlib, sys, uuid
out, script = sys.argv[1:]
command = f'nohup /usr/bin/python3 "{script}" "$@" >/dev/null 2>&1 &'
u = lambda: str(uuid.uuid4()).upper()
action = {
    "AMAccepts": {"Container": "List", "Optional": True, "Types": ["com.apple.cocoa.string"]},
    "AMActionVersion": "2.0.3",
    "AMApplication": ["Automator"],
    "AMParameterProperties": {k: {} for k in ["COMMAND_STRING", "CheckedForUserDefaultShell", "inputMethod", "shell", "source"]},
    "AMProvides": {"Container": "List", "Types": ["com.apple.cocoa.string"]},
    "ActionBundlePath": "/System/Library/Automator/Run Shell Script.action",
    "ActionName": "Run Shell Script",
    "ActionParameters": {"COMMAND_STRING": command, "CheckedForUserDefaultShell": True, "inputMethod": 1, "shell": "/bin/zsh", "source": ""},
    "BundleIdentifier": "com.apple.RunShellScript",
    "CFBundleVersion": "2.0.3",
    "CanShowSelectedItemsWhenRun": False,
    "CanShowWhenRun": True,
    "Category": ["AMCategoryUtilities"],
    "Class Name": "RunShellScriptAction",
    "InputUUID": u(), "OutputUUID": u(), "UUID": u(),
    "Keywords": ["Shell", "Script", "Command", "Run", "Unix"],
    "UnlocalizedApplications": ["Automator"],
    "arguments": {
        str(i): {"default value": dv, "name": n, "required": "0", "type": "0", "uuid": str(i)}
        for i, (n, dv) in enumerate([("inputMethod", 0), ("CheckedForUserDefaultShell", False), ("source", ""), ("COMMAND_STRING", ""), ("shell", "")])
    },
    "isViewVisible": 1,
    "location": "309.000000:253.000000",
    "nibPath": "/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib",
}
doc = {
    "AMApplicationBuild": "523", "AMApplicationVersion": "2.10", "AMDocumentVersion": "2",
    "actions": [{"action": action, "isViewVisible": 1}],
    "connectors": {},
    "workflowMetaData": {
        "applicationBundleIDsByPath": {}, "applicationPaths": [],
        "inputTypeIdentifier": "com.apple.Automator.fileSystemObject.folder",
        "outputTypeIdentifier": "com.apple.Automator.nothing",
        "presentationMode": 15, "processesInput": False,
        "serviceApplicationBundleID": "com.apple.finder",
        "serviceApplicationPath": "/System/Library/CoreServices/Finder.app",
        "serviceInputTypeIdentifier": "com.apple.Automator.fileSystemObject.folder",
        "serviceOutputTypeIdentifier": "com.apple.Automator.nothing",
        "serviceProcessesInput": False,
        "systemImageName": "NSActionTemplate",
        "useAutomaticInputType": False,
        "workflowTypeIdentifier": "com.apple.Automator.servicesMenu",
    },
}
plistlib.dump(doc, open(out, "wb"))
PY
/System/Library/CoreServices/pbs -flush 2>/dev/null || true
echo "Added Finder Quick Action: Make Q-Bank Questions"

# The question-writing skill, for Claude Code (claude -p) to use.
mkdir -p "$HOME/.claude/skills"
ln -sfn "${DIR:h}/claude-skill/qbank-generator" "$HOME/.claude/skills/qbank-generator"
echo "Linked the qbank-generator skill into ~/.claude/skills"
