// The "File Lectures" window: the lecture files still loose in a course, Week or day folder, each with
// the organizer's best guess, and a menu to pick the lecture yourself; plus the last files filed, to
// move or put back. organize.py opens it when it can't place a file. All the deciding and moving is
// filing.py's (bundled in Resources); every command there answers with the whole picture as JSON.
// Built by build_window.sh: swiftc -parse-as-library -O QBankFiling.swift
import AppKit
import SwiftUI

let dayNames = ["1 Monday", "2 Tuesday", "3 Wednesday", "4 Thursday", "5 Friday"]

// MARK: - What filing.py prints

struct Snapshot: Decodable {
    var error: String?
    var courses: [Course]?
    var unfiled: [Unfiled]?
    var left: [LeftFile]?
    var recent: [Recent]?
    var destinations: [Destination]?
    var problems: [String]?
}

struct Course: Decodable, Hashable {
    var name: String
    var root: String
    var currentWeek: Int?
}

struct Unfiled: Decodable, Identifiable {
    var path: String
    var name: String
    var course: String
    var `where`: String
    var week: Int?
    var day: Int?
    var candidates: [String]
    var sure: Bool
    var id: String { path }
}

struct LeftFile: Decodable, Identifiable {
    var path: String
    var name: String
    var `where`: String
    var id: String { path }
}

struct Recent: Decodable, Identifiable {
    var id: String
    var name: String
    var dest: String
    var label: String
    var when: String
    var auto: Bool
    var course: String
}

struct Destination: Decodable, Identifiable, Hashable {
    var id: String  // the folder's path
    var course: String
    var week: Int
    var day: Int
    var name: String
    var title: String
}

/// What "New folder…" is making a folder for.
struct NewFolderRequest: Identifiable {
    enum Target { case unfiled(String), recent(String) }
    var target: Target
    var fileName: String
    var course: String
    var week: Int?
    var day: Int?
    var id: String { fileName }
}

// MARK: - Model

final class Model: ObservableObject {
    @Published var snapshot = Snapshot()
    @Published var loaded = false
    @Published var busy = false
    @Published var failure: String?
    @Published var problems: [String] = []
    @Published var choice: [String: String] = [:]  // unfiled path → folder it'll go to
    @Published var picked: Set<String> = []  // the paths whose folder you chose yourself
    @Published var newFolder: NewFolderRequest?
    private var timer: Timer?
    private var watcher: NSObjectProtocol?

    static var script: String {
        ProcessInfo.processInfo.environment["QBANK_FILING_SCRIPT"]
            ?? Bundle.main.resourceURL?.appendingPathComponent("filing.py").path ?? "filing.py"
    }

    init(live: Bool = true) {
        guard live else { return }
        refresh()
        // The organizer keeps filing in the background, and opens this window again for anything it can't place.
        watcher = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refresh()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    /// Run one filing.py command and decode the picture it prints.
    static func call(_ command: String, _ payload: [String: Any]? = nil) -> Snapshot {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        p.arguments = [script, command]
        let out = Pipe(), input = Pipe()
        p.standardOutput = out
        p.standardInput = input
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return Snapshot(error: "Couldn't start the filing helper: \(error.localizedDescription)") }
        if let payload, let data = try? JSONSerialization.data(withJSONObject: payload) { input.fileHandleForWriting.write(data) }
        try? input.fileHandleForWriting.close()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard let s = try? JSONDecoder().decode(Snapshot.self, from: data) else {
            return Snapshot(error: "The filing helper didn't answer. See ~/Library/Logs/Q-Bank Slides.log.")
        }
        return s
    }

    func refresh() {
        guard !busy else { return }
        run("snapshot", nil, quiet: true)
    }

    func run(_ command: String, _ payload: [String: Any]?, quiet: Bool = false) {
        if !quiet { busy = true }
        DispatchQueue.global(qos: .userInitiated).async {
            let s = Model.call(command, payload)
            DispatchQueue.main.async {
                if !quiet { self.busy = false }
                self.apply(s, quiet: quiet)
            }
        }
    }

    func apply(_ s: Snapshot, quiet: Bool) {
        loaded = true
        if let e = s.error {
            failure = e
            return
        }
        failure = nil
        snapshot = s
        if !quiet { problems = s.problems ?? [] }
        // Keep what you've chosen; start each new file on the organizer's best guess.
        var next: [String: String] = [:]
        for f in s.unfiled ?? [] { next[f.path] = picked.contains(f.path) ? choice[f.path] : f.candidates.first }
        choice = next
        picked = picked.intersection(next.keys)
    }

    var unfiled: [Unfiled] { snapshot.unfiled ?? [] }
    var ready: [Unfiled] { unfiled.filter { choice[$0.path] != nil } }

    func root(_ course: String) -> String { snapshot.courses?.first { $0.name == course }?.root ?? "" }

    func destinations(_ course: String) -> [Destination] { (snapshot.destinations ?? []).filter { $0.course == course } }

    /// "Week 16 › 1 Monday › Asthma" for a lecture folder.
    func label(_ folder: String) -> String {
        URL(fileURLWithPath: folder).pathComponents.suffix(3).joined(separator: " › ")
    }

    /// "Week 16 › 1 Monday", the day a lecture folder is in.
    func dayLabel(_ folder: String) -> String {
        URL(fileURLWithPath: folder).pathComponents.suffix(3).prefix(2).joined(separator: " › ")
    }

    func pick(_ path: String, _ folder: String) {
        choice[path] = folder
        picked.insert(path)
    }

    func file(_ files: [Unfiled]) {
        let items = files.compactMap { f in choice[f.path].map { ["path": f.path, "dest": $0] } }
        guard !items.isEmpty else { return }
        run("file", ["items": items])
    }

    func undo(_ r: Recent) { run("undo", ["id": r.id]) }
    func relocate(_ r: Recent, to folder: String) { run("relocate", ["id": r.id, "dest": folder]) }
    func leave(_ path: String) { run("leave", ["path": path]) }
    func askAgain(_ path: String) { run("ask", ["path": path]) }

    func makeFolder(_ request: NewFolderRequest, week: Int, day: Int, name: String) {
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty, !clean.hasPrefix("."), (1...5).contains(day) else { return }
        let folder = URL(fileURLWithPath: root(request.course))
            .appendingPathComponent("Week \(week)").appendingPathComponent(dayNames[day - 1]).appendingPathComponent(clean).path
        switch request.target {
        case .unfiled(let path): pick(path, folder)
        case .recent(let id): run("relocate", ["id": id, "dest": folder])
        }
    }

    /// `QBankFiling --check`: ask filing.py for the picture and print what's in it, with no window (for the installer).
    static func check() -> Int32 {
        let s = call("snapshot")
        if let e = s.error { FileHandle.standardError.write(Data((e + "\n").utf8)); return 1 }
        print("\(s.unfiled?.count ?? 0) waiting, \(s.recent?.count ?? 0) recently filed, \(s.destinations?.count ?? 0) lecture folders")
        return 0
    }
}

// MARK: - Views

/// The menu of lecture folders: the closest matches, then every week › day › lecture, then "New folder…".
struct DestinationMenu<Label: View>: View {
    @ObservedObject var model: Model
    var course: String
    var suggestions: [String] = []
    var pick: (String) -> Void
    var newFolder: () -> Void
    @ViewBuilder var label: () -> Label

    var body: some View {
        let all = model.destinations(course)
        let weeks = Array(Set(all.map(\.week))).sorted()
        Menu {
            if !suggestions.isEmpty {
                Section("Closest matches") {
                    ForEach(suggestions, id: \.self) { s in Button(model.label(s)) { pick(s) } }
                }
            }
            Section("All lectures") {
                ForEach(weeks, id: \.self) { w in
                    Menu("Week \(w)") {
                        ForEach(1...5, id: \.self) { d in
                            let here = all.filter { $0.week == w && $0.day == d }
                            if !here.isEmpty {
                                Menu(dayNames[d - 1]) {
                                    ForEach(here) { dest in Button(dest.name) { pick(dest.id) } }
                                }
                            }
                        }
                    }
                }
            }
            Divider()
            Button("New folder…", action: newFolder)
        } label: {
            label()
        }
    }
}

struct UnfiledRow: View {
    @ObservedObject var model: Model
    var file: Unfiled

    var hint: (String, Color) {
        guard let chosen = model.choice[file.path] else { return ("No match found. Pick a lecture.", .orange) }
        let day = model.dayLabel(chosen)
        if model.picked.contains(file.path) { return ("\(day)  ·  Your pick", .secondary) }
        return file.sure ? ("\(day)  ·  Matched automatically", .secondary) : ("\(day)  ·  Best guess, check it", .orange)
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: file.path)).resizable().frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name).fontWeight(.medium).lineLimit(1).truncationMode(.middle).help(file.name)
                Text("In \(file.where)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .leading, spacing: 2) {
                DestinationMenu(
                    model: model, course: file.course, suggestions: file.candidates,
                    pick: { model.pick(file.path, $0) },
                    newFolder: { model.newFolder = NewFolderRequest(target: .unfiled(file.path), fileName: file.name, course: file.course, week: file.week, day: file.day) }
                ) {
                    Text(model.choice[file.path].map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Choose a lecture…")
                        .lineLimit(1).truncationMode(.tail)
                }
                .frame(width: 300, alignment: .leading)
                Text(hint.0).font(.caption).foregroundStyle(hint.1).lineLimit(1)
            }
            .frame(width: 300, alignment: .leading)
            Button("File") { model.file([file]) }.disabled(model.choice[file.path] == nil || model.busy)
            Menu {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: file.path)]) }
                Button("Open") { NSWorkspace.shared.open(URL(fileURLWithPath: file.path)) }
                Divider()
                Button("Leave It Where It Is") { model.leave(file.path) }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(.vertical, 8)
    }
}

struct RecentRow: View {
    @ObservedObject var model: Model
    var item: Recent

    static let parser: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f
    }()

    var ago: String {
        guard let d = RecentRow.parser.date(from: item.when) else { return "" }
        if Date().timeIntervalSince(d) < 60 { return "just now" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.auto ? "wand.and.stars" : "hand.point.up.left").foregroundStyle(.secondary).frame(width: 30)
                .help(item.auto ? "Filed automatically" : "Filed by you")
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).lineLimit(1).truncationMode(.middle).help(item.name)
                Text("\(item.label)  ·  \(ago)").font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if !item.course.isEmpty {
                DestinationMenu(
                    model: model, course: item.course,
                    pick: { model.relocate(item, to: $0) },
                    newFolder: { model.newFolder = NewFolderRequest(target: .recent(item.id), fileName: item.name, course: item.course, week: nil, day: nil) }
                ) {
                    Text("Move to…")
                }
                .fixedSize()
            }
            Button("Undo") { model.undo(item) }.help("Put it back where it was")
            Button {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: item.dest)])
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .buttonStyle(.borderless).help("Show in Finder")
        }
        .padding(.vertical, 6)
        .disabled(model.busy)
    }
}

struct NewFolderSheet: View {
    @ObservedObject var model: Model
    var request: NewFolderRequest
    @State private var week = 0
    @State private var day = 1
    @State private var name = ""

    var weeks: [Int] {
        var all = Set(model.destinations(request.course).map(\.week))
        if let w = request.week { all.insert(w) }
        return all.sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New lecture folder").font(.title3.bold())
            Text("For “\(request.fileName)”").foregroundStyle(.secondary).lineLimit(2)
            Form {
                Picker("Week", selection: $week) {
                    ForEach(weeks, id: \.self) { Text("Week \($0)").tag($0) }
                }
                Picker("Day", selection: $day) {
                    ForEach(1...5, id: \.self) { Text(dayNames[$0 - 1]).tag($0) }
                }
                TextField("Name", text: $name, prompt: Text("Folder name"))
            }
            HStack {
                Spacer()
                Button("Cancel") { model.newFolder = nil }.keyboardShortcut(.cancelAction)
                Button("Use This Folder") {
                    model.makeFolder(request, week: week, day: day, name: name)
                    model.newFolder = nil
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || week == 0)
            }
        }
        .padding(20)
        .frame(width: 420)
        .onAppear {
            let current = model.snapshot.courses?.first { $0.name == request.course }?.currentWeek
            week = request.week ?? current ?? weeks.first ?? 0
            let weekday = Calendar(identifier: .gregorian).component(.weekday, from: Date()) - 1  // Monday = 1
            day = request.day ?? ((1...5).contains(weekday) ? weekday : 1)
        }
    }
}

struct SectionTitle: View {
    var text: String
    var body: some View {
        Text(text).font(.headline).padding(.top, 14).padding(.bottom, 2)
    }
}

struct RootView: View {
    @ObservedObject var model: Model
    @State private var showLeft = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let failure = model.failure {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                    Text(failure).multilineTextAlignment(.center).textSelection(.enabled).foregroundStyle(.secondary)
                    Button("Try Again") { model.refresh() }
                }
                .padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !model.loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView { content.padding(.horizontal, 20).padding(.bottom, 16) }
                Divider()
                footer
            }
        }
        .frame(minWidth: 780, idealWidth: 860, minHeight: 460, idealHeight: 620)
        .sheet(item: $model.newFolder) { NewFolderSheet(model: model, request: $0) }
    }

    var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("File Lectures").font(.title2.bold())
                Text((model.snapshot.courses ?? []).map(\.name).joined(separator: ", ")).foregroundStyle(.secondary)
            }
            Spacer()
            ForEach(model.snapshot.courses ?? [], id: \.self) { c in
                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: c.root))
                } label: {
                    Label(c.name, systemImage: "folder")
                }
                .buttonStyle(.link)
            }
        }
        .padding([.horizontal, .top], 20).padding(.bottom, 12)
    }

    var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(model.problems, id: \.self) { p in
                Label(p, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).padding(.top, 10)
            }
            SectionTitle(text: "Waiting to be filed")
            if model.unfiled.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.title3)
                    Text("Nothing waiting. Lecture files you drop into a course folder are filed for you, and anything unclear shows up here.")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 10)
            }
            ForEach(model.unfiled) { f in
                UnfiledRow(model: model, file: f)
                Divider()
            }
            let recent = model.snapshot.recent ?? []
            if !recent.isEmpty {
                SectionTitle(text: "Recently filed")
                ForEach(recent.prefix(15)) { r in
                    RecentRow(model: model, item: r)
                    Divider()
                }
            }
            let left = model.snapshot.left ?? []
            if !left.isEmpty {
                DisclosureGroup("Left where they are (\(left.count))", isExpanded: $showLeft) {
                    ForEach(left) { f in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.name).lineLimit(1).truncationMode(.middle)
                                Text("In \(f.where)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("File It After All") { model.askAgain(f.path) }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .padding(.top, 14)
            }
        }
    }

    var footer: some View {
        HStack {
            if model.busy { ProgressView().controlSize(.small) }
            Text("Picking a lecture yourself is remembered, so its other files follow.").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button("Done") { NSApp.terminate(nil) }
            let n = model.ready.count
            Button(n == 1 ? "File 1 File" : "File All \(n)") { model.file(model.ready) }
                .keyboardShortcut(.defaultAction)
                .disabled(n == 0 || model.busy)
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct QBankFilingApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    init() {
        if CommandLine.arguments.contains("--check") { exit(Model.check()) }
    }
    @StateObject private var model = Model()

    var body: some Scene {
        Window("File Lectures", id: "main") {
            RootView(model: model)
        }
        .windowResizability(.contentMinSize)
    }
}
