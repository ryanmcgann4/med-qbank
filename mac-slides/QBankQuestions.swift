// The "Make Q-Bank Questions" window. make_questions.py starts it with a work folder:
//   plan.json     (script → window)  the day's lectures, files, bank lectures and Library folders
//   options.json  (window → script)  what you chose; quitting without writing it means Cancel
//   status.json   (script → window)  progress per lecture, once it's running
//   stop          (window → script)  stop after the current step
// Built by install.sh: swiftc -parse-as-library -O QBankQuestions.swift
import AppKit
import SwiftUI

// MARK: - Files shared with make_questions.py

struct Plan: Decodable {
    var error: String?
    var course = ""
    var week = 0
    var day = 0
    var date = ""
    var dayLabel = ""
    var dayPath = ""
    var lectures: [PlanLecture] = []
    var bankLectures: [BankLecture] = []
    var folders: [FolderRef] = []
    var dayFolder: DayFolder?
    var defaults: GlobalOptions?
}

struct PlanLecture: Decodable, Identifiable {
    var key: String
    var folderName: String
    var title: String
    var files: [PlanFile]
    var match: String?
    var selected: Bool
    var id: String { key }
}

struct PlanFile: Decodable, Hashable {
    var name: String
    var kind: String
    var pages: Int?
}

struct BankLecture: Decodable {
    var lectureId: String
    var title: String
    var questions: Int
    var folderId: String?
    var folderPath: String
}

struct FolderRef: Decodable, Hashable {
    var id: String
    var path: String
}

struct DayFolder: Decodable {
    var id: String
    var path: String
    var exists: Bool
}

struct GlobalOptions: Codable {
    var count = 0
    var difficulty = "exam"
    var style = "vignettes"
    var yieldFocus = "balanced"
    var practice = true
    var notes = ""
    var model = ""
    var addToBank = true
    var remember = true
}

struct LectureOptions: Codable, Identifiable {
    var key: String
    var include: Bool
    var title: String
    var target: String  // "new" or a bank lecture id
    var count: Int  // 0 = let Claude decide
    var files: [String]
    var folder: String  // Library folder id, or "top"
    var newFolder: String
    var id: String { key }
}

struct Options: Encodable {
    var global: GlobalOptions
    var lectures: [LectureOptions]
}

struct Status: Decodable {
    var lectures: [StatusRow]
    var done: Bool
    var summary: String
}

struct StatusRow: Decodable, Identifiable {
    var key: String
    var title: String
    var lectureId: String
    var state: String
    var phase: String
    var questions: Int?
    var message: String
    var id: String { key }
}

// MARK: - Model

final class Model: ObservableObject {
    enum Stage { case loading, failed(String), form, running }

    let work: URL
    @Published var stage = Stage.loading
    @Published var plan = Plan()
    @Published var global = GlobalOptions()
    @Published var lectures: [LectureOptions] = []
    @Published var status: Status?
    @Published var stopping = false
    @Published var started = Date()
    private var timer: Timer?

    init(work: URL, live: Bool = true) {
        self.work = work
        if live { timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.poll() } }
    }

    /// `QBankQuestions <work> --check`: read plan.json and write the default options.json with no window (for tests).
    static func check(_ work: URL) -> Int32 {
        let m = Model(work: work, live: false)
        m.poll()
        if case .failed(let e) = m.stage { FileHandle.standardError.write(Data((e + "\n").utf8)); return 2 }
        guard case .form = m.stage else { FileHandle.standardError.write(Data("plan.json missing or unreadable\n".utf8)); return 1 }
        m.start()
        return 0
    }

    private func read<T: Decodable>(_ name: String, as: T.Type) -> T? {
        guard let data = try? Data(contentsOf: work.appendingPathComponent(name)) else { return nil }
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return try? d.decode(T.self, from: data)
    }

    fileprivate func poll() {
        switch stage {
        case .loading:
            guard let p = read("plan.json", as: Plan.self) else { return }
            if let e = p.error { stage = .failed(e); return }
            plan = p
            global = p.defaults ?? GlobalOptions()
            lectures = p.lectures.map { l in
                let target = l.match ?? "new"
                return LectureOptions(
                    key: l.key, include: l.selected, title: l.title, target: target, count: global.count,
                    files: l.files.map(\.name), folder: defaultFolder(for: target), newFolder: "")
            }
            stage = .form
        case .running:
            if let s = read("status.json", as: Status.self) { status = s }
        default:
            break
        }
    }

    // Where a lecture goes if you don't pick: where it already is, or the day's folder.
    func defaultFolder(for target: String) -> String {
        if let b = plan.bankLectures.first(where: { $0.lectureId == target }) { return b.folderId ?? "top" }
        return plan.dayFolder?.id ?? "top"
    }

    var folderChoices: [FolderRef] {
        var out = [FolderRef(id: "top", path: "Top level of the Library")]
        if let d = plan.dayFolder, !d.exists { out.append(FolderRef(id: d.id, path: d.path + "  (new)")) }
        return out + plan.folders
    }

    func folderPath(_ id: String) -> String {
        folderChoices.first(where: { $0.id == id })?.path ?? "Library"
    }

    var chosen: [LectureOptions] { lectures.filter { $0.include && !$0.files.isEmpty } }

    func planLecture(_ key: String) -> PlanLecture? { plan.lectures.first { $0.key == key } }

    func bank(_ id: String) -> BankLecture? { plan.bankLectures.first { $0.lectureId == id } }

    func setAllCounts(_ n: Int) {
        global.count = n
        for i in lectures.indices { lectures[i].count = n }
    }

    func start() {
        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        enc.outputFormatting = .prettyPrinted
        guard let data = try? enc.encode(Options(global: global, lectures: lectures)) else { return }
        let tmp = work.appendingPathComponent("options.json.tmp")
        try? data.write(to: tmp)
        _ = try? FileManager.default.replaceItemAt(work.appendingPathComponent("options.json"), withItemAt: tmp)
        if !FileManager.default.fileExists(atPath: work.appendingPathComponent("options.json").path) {
            try? FileManager.default.moveItem(at: tmp, to: work.appendingPathComponent("options.json"))
        }
        started = Date()
        stage = .running
    }

    func stop() {
        stopping = true
        FileManager.default.createFile(atPath: work.appendingPathComponent("stop").path, contents: Data())
    }
}

// MARK: - Views

struct RootView: View {
    @ObservedObject var model: Model

    var body: some View {
        Group {
            switch model.stage {
            case .loading:
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Checking the lecture folders and your Q-Bank…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let msg):
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                    Text("Couldn't get ready").font(.title3.bold())
                    Text(msg).multilineTextAlignment(.center).textSelection(.enabled).foregroundStyle(.secondary)
                    Button("Close") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
                }
                .padding(30)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .form:
                FormView(model: model)
            case .running:
                ProgressListView(model: model)
            }
        }
        .frame(minWidth: 640, idealWidth: 720, minHeight: 520, idealHeight: 760)
    }
}

struct Header: View {
    @ObservedObject var model: Model
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Make Q-Bank Questions").font(.title2.bold())
                Text("\(model.plan.course) · \(model.plan.dayLabel)").foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                NSWorkspace.shared.open(URL(fileURLWithPath: model.plan.dayPath))
            } label: {
                Label("Show in Finder", systemImage: "folder")
            }
            .buttonStyle(.link)
        }
        .padding([.horizontal, .top], 20)
        .padding(.bottom, 8)
    }
}

struct FormView: View {
    @ObservedObject var model: Model

    var body: some View {
        VStack(spacing: 0) {
            Header(model: model)
            Form {
                Section {
                    Picker("Questions per lecture", selection: Binding(get: { model.global.count }, set: { model.setAllCounts($0) })) {
                        Text("Let Claude decide (8–15 per hour)").tag(0)
                        ForEach([5, 8, 10, 12, 15, 20, 25, 30], id: \.self) { Text("\($0)").tag($0) }
                    }
                    Text("Sets every lecture below; you can still change each one.").font(.caption).foregroundStyle(.secondary)
                } header: {
                    Text("Amount")
                }

                ForEach($model.lectures) { $lec in
                    LectureSection(model: model, lec: $lec)
                }

                StyleSection(model: model)

                Section("When it's done") {
                    Toggle("Add the questions to Q-Bank", isOn: $model.global.addToBank)
                    if !model.global.addToBank {
                        Text("The file is saved in the day folder for you to look over and import in the app.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Toggle("Remember these settings for next time", isOn: $model.global.remember)
                }
            }
            .formStyle(.grouped)
            Divider()
            Footer(model: model)
        }
    }
}

struct LectureSection: View {
    @ObservedObject var model: Model
    @Binding var lec: LectureOptions

    var plan: PlanLecture? { model.planLecture(lec.key) }

    var body: some View {
        Section {
            if lec.include, let plan {
                TextField("Title in Q-Bank", text: $lec.title)

                Picker("Q-Bank lecture", selection: Binding(get: { lec.target }, set: { t in
                    lec.target = t
                    lec.folder = model.defaultFolder(for: t)
                })) {
                    Text("New lecture").tag("new")
                    ForEach(model.plan.bankLectures, id: \.lectureId) { b in
                        Text("Add to “\(b.title)” (\(b.questions) questions)").tag(b.lectureId)
                    }
                }
                if let b = model.bank(lec.target) {
                    Label("Already in your bank with \(b.questions) questions. New ones won't repeat them.", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(.secondary)
                } else if plan.match != nil {
                    Label("A lecture with this name is already in your bank. Pick it above to add to it instead.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }

                Picker("Questions", selection: $lec.count) {
                    Text("Let Claude decide").tag(0)
                    ForEach(Array(1...40), id: \.self) { Text("\($0)").tag($0) }
                }

                Picker("Library folder", selection: $lec.folder) {
                    ForEach(model.folderChoices, id: \.id) { f in
                        Text(f.id == model.defaultFolder(for: lec.target) ? "\(f.path)  (default)" : f.path).tag(f.id)
                    }
                }
                TextField("New subfolder inside it (optional)", text: $lec.newFolder, prompt: Text("e.g. Exam 2 review"))
                Text("Goes to: \(model.folderPath(lec.folder))\(lec.newFolder.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " › " + lec.newFolder.trimmingCharacters(in: .whitespaces))")
                    .font(.caption).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Files to use")
                    ForEach(plan.files, id: \.self) { f in
                        Toggle(isOn: Binding(
                            get: { lec.files.contains(f.name) },
                            set: { on in lec.files = on ? lec.files + [f.name] : lec.files.filter { $0 != f.name } }
                        )) {
                            HStack {
                                Image(systemName: f.kind == "pdf" ? "doc.richtext" : "rectangle.on.rectangle")
                                    .foregroundStyle(.secondary)
                                Text(f.name).lineLimit(1).truncationMode(.middle)
                                if let p = f.pages {
                                    Text(f.kind == "pdf" ? "\(p) pages" : "\(p) slides").foregroundStyle(.secondary)
                                }
                            }
                        }
                        .toggleStyle(.checkbox)
                    }
                    if lec.files.isEmpty {
                        Text("Pick at least one file.").font(.caption).foregroundStyle(.red)
                    }
                }
            }
        } header: {
            HStack {
                Toggle(isOn: $lec.include) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lec.title).font(.headline).lineLimit(2)
                        Text("Folder: \(plan?.folderName ?? lec.key)\(plan?.files.isEmpty == true ? " · no slides or PDFs" : "")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .disabled(plan?.files.isEmpty ?? true)
                Spacer()
                if let b = model.bank(plan?.match ?? "") {
                    Text("\(b.questions) in bank").font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }
        }
    }
}

struct StyleSection: View {
    @ObservedObject var model: Model

    var body: some View {
        Section("Question style") {
            Picker("Difficulty", selection: $model.global.difficulty) {
                Text("Easier").tag("easier")
                Text("Exam level").tag("exam")
                Text("Harder").tag("harder")
            }
            .pickerStyle(.segmented)
            Picker("Kind of questions", selection: $model.global.style) {
                Text("Mostly vignettes").tag("vignettes")
                Text("Mix").tag("mixed")
                Text("Mostly concepts").tag("concepts")
            }
            .pickerStyle(.segmented)
            Picker("Yield", selection: $model.global.yieldFocus) {
                Text("Half high, half low").tag("balanced")
                Text("High-yield only").tag("high")
            }
            .pickerStyle(.segmented)
            Text(model.global.yieldFocus == "high"
                 ? "Only the material most likely to be on the exam, all rated high yield. Good when you're short on time."
                 : "Covers the whole lecture; the most testable half is rated high yield so you can filter by it later.")
                .font(.caption).foregroundStyle(.secondary)
            Toggle("Include the practice questions on the slides", isOn: $model.global.practice)
            Picker("Claude model", selection: $model.global.model) {
                Text("Default").tag("")
                Text("Opus (best)").tag("opus")
                Text("Sonnet (faster)").tag("sonnet")
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Anything else for Claude?")
                TextEditor(text: $model.global.notes)
                    .font(.body)
                    .frame(minHeight: 54)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
                Text("e.g. “Focus on drug mechanisms and side effects” or “Skip the history slides”.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct Footer: View {
    @ObservedObject var model: Model

    var body: some View {
        let chosen = model.chosen
        let fixed = chosen.map(\.count).filter { $0 > 0 }.reduce(0, +)
        let auto = chosen.filter { $0.count == 0 }.count
        let amount = [fixed > 0 ? "\(fixed) question\(fixed == 1 ? "" : "s")" : nil, auto > 0 ? "\(auto) lecture\(auto == 1 ? "" : "s") at Claude's pick" : nil]
            .compactMap { $0 }.joined(separator: " + ")
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(chosen.isEmpty ? "Tick a lecture to make questions." : "\(chosen.count) lecture\(chosen.count == 1 ? "" : "s") · \(amount)")
                if !chosen.isEmpty {
                    Text("About \(chosen.count * 5)–\(chosen.count * 10) minutes. You can close this window; you'll get a notification.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button("Cancel") { NSApp.terminate(nil) }.keyboardShortcut(.cancelAction)
            Button("Make Questions") { model.start() }
                .keyboardShortcut(.defaultAction)
                .disabled(chosen.isEmpty || model.lectures.contains { $0.include && $0.files.isEmpty })
        }
        .padding(16)
    }
}

struct ProgressListView: View {
    @ObservedObject var model: Model

    var body: some View {
        VStack(spacing: 0) {
            Header(model: model)
            List {
                ForEach(model.status?.lectures ?? []) { row in
                    HStack(alignment: .top, spacing: 12) {
                        icon(row.state).frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.title).font(.headline)
                            Text(detail(row)).foregroundStyle(row.state == "failed" ? .red : .secondary).textSelection(.enabled)
                            Text(row.lectureId).font(.caption.monospaced()).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        if let n = row.questions, n > 0 {
                            Text("\(n) Q").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.inset)
            Divider()
            HStack {
                if let s = model.status, s.done {
                    Label(s.summary, systemImage: "checkmark.seal.fill").foregroundStyle(.green).lineLimit(2)
                } else {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text("Working · \(elapsed(ctx.date))").foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                Spacer()
                Button("Show Log") {
                    NSWorkspace.shared.open(URL(fileURLWithPath: NSString(string: "~/Library/Logs/Q-Bank Questions.log").expandingTildeInPath))
                }
                if model.status?.done ?? false {
                    Button("Done") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
                } else {
                    Button(model.stopping ? "Stopping…" : "Stop") { model.stop() }.disabled(model.stopping)
                    Button("Hide") { NSApp.terminate(nil) }
                        .help("Close this window; the questions keep being made and you'll get a notification.")
                }
            }
            .padding(16)
        }
    }

    func elapsed(_ now: Date) -> String {
        let s = Int(now.timeIntervalSince(model.started))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    func detail(_ row: StatusRow) -> String {
        switch row.state {
        case "queued": return "Waiting its turn"
        case "working": return row.phase.isEmpty ? "Working…" : row.phase + "…"
        default: return row.message
        }
    }

    @ViewBuilder func icon(_ state: String) -> some View {
        switch state {
        case "working": ProgressView().controlSize(.small)
        case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "failed": Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        case "stopped": Image(systemName: "stop.circle").foregroundStyle(.secondary)
        default: Image(systemName: "clock").foregroundStyle(.secondary)
        }
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
struct QBankQuestionsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    init() {
        let args = CommandLine.arguments
        if args.contains("--check"), args.count > 1 { exit(Model.check(URL(fileURLWithPath: args[1]))) }
    }
    @StateObject private var model = Model(
        work: URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath))

    var body: some Scene {
        Window("Make Q-Bank Questions", id: "main") {
            RootView(model: model)
        }
        .windowResizability(.contentMinSize)
    }
}
