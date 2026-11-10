#!/bin/zsh
# Sets up the Q-Bank helpers on this Mac:
#  - "Q-Bank Slides.app" in ~/Applications, registered for qbank-slides:// links, so Q-Bank's
#    "Open slides" button opens the lecture file at its slide
#  - a LaunchAgent that organizes lecture files you drop into the course folder into
#    Week N/<n Day>/<Lecture>/ (needs schedule.json, from parse_schedule.py); Downloads is left alone
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
cp "$DIR"/open_slide.py "$DIR"/common.py "$DIR"/organize.py "$APP/Contents/Resources/"
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

# Watch each course folder and its Week/day folders: a change opens qbank-slides://organize, which the
# app handles. (Run this again after adding a new Week folder so it's watched too.)
OLD="$HOME/Library/LaunchAgents/local.qbank.file-downloads.plist"
if [[ -f "$OLD" ]]; then
  launchctl bootout "gui/$(id -u)" "$OLD" 2>/dev/null || true
  rm -f "$OLD" "$SUPPORT/filed-state.json"
fi
AGENT="$HOME/Library/LaunchAgents/local.qbank.organize.plist"
mkdir -p "$HOME/Library/LaunchAgents"
/usr/bin/python3 - "$AGENT" "$DIR" <<'PY'
import plistlib, sys
agent, here = sys.argv[1:]
sys.path.insert(0, here)
import organize
from common import load
roots = {c: r for c, r in load("config.json", {}).get("courses", {}).items()}
plistlib.dump({
    "Label": "local.qbank.organize",
    "ProgramArguments": ["/usr/bin/open", "-g", "qbank-slides://organize"],
    "WatchPaths": organize.watch_paths(roots),
    "ThrottleInterval": 5,
}, open(agent, "wb"))
PY
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "Organizing files you drop into: $(/usr/bin/python3 -c 'import json,os; print(", ".join(json.load(open(os.path.expanduser("~/Library/Application Support/Q-Bank Slides/config.json")))["courses"].values()))')"

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
