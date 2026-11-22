// Game Plan menu bar companion.
// - Shows the shared focus timer in the menu bar (pause / resume / keep going / finish / break from the menu).
// - ⌥⌘G opens Game Plan from anywhere (a Carbon hot key: no Accessibility permission needed).
// - Lock or sleep pauses the timer; unlock or wake asks Game Plan whether to show a start/resume prompt
//   (only inside your study windows, outside quiet hours, not while snoozed or on a break).
// Talks only to the local Game Plan server. Set GP_BASE to point elsewhere, GP_NO_OPEN=1 to log instead of opening windows.
import Cocoa
import Carbon

let env = ProcessInfo.processInfo.environment
let BASE = env["GP_BASE"] ?? "http://127.0.0.1:4317"
let NO_OPEN = env["GP_NO_OPEN"] == "1"
let VERSION = "1.0.0"

func log(_ s: String) { FileHandle.standardOutput.write((ISO8601DateFormatter().string(from: Date()) + " " + s + "\n").data(using: .utf8)!) }

final class Bar: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    var session: [String: Any]? = nil
    var fetchedAt = Date()
    var online = false
    var hotKey: EventHotKeyRef?

    func applicationDidFinishLaunching(_ n: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        item.button?.imagePosition = .imageLeading
        let menu = NSMenu(); menu.delegate = self; item.menu = menu
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(self, selector: #selector(locked), name: .init("com.apple.screenIsLocked"), object: nil)
        dnc.addObserver(self, selector: #selector(unlocked), name: .init("com.apple.screenIsUnlocked"), object: nil)
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(sleeping), name: NSWorkspace.willSleepNotification, object: nil)
        ws.addObserver(self, selector: #selector(woke), name: NSWorkspace.didWakeNotification, object: nil)
        registerHotKey()
        draw(); poll(); send("hello")
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.poll() }
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.draw() }
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.send("heartbeat") }
        log("GamePlanBar \(VERSION) → \(BASE)")
    }

    // MARK: server
    func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, _ done: (([String: Any]?) -> Void)? = nil) {
        guard let url = URL(string: BASE + path) else { return }
        var req = URLRequest(url: url, timeoutInterval: 4)
        req.httpMethod = method
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("1", forHTTPHeaderField: "X-Game-Plan")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async { self.online = ok || json != nil; done?(ok ? json : nil) }
        }.resume()
    }
    func send(_ action: String, _ extra: [String: Any] = [:], _ done: (([String: Any]?) -> Void)? = nil) {
        var b: [String: Any] = ["action": action, "device": "mac", "version": VERSION, "reqId": UUID().uuidString]
        extra.forEach { b[$0.key] = $0.value }
        call("POST", "/api/focus", b) { j in
            if let j = j, j.keys.contains("session") { self.session = j["session"] as? [String: Any]; self.fetchedAt = Date(); self.draw() }
            done?(j)
        }
    }
    func poll() {
        call("GET", "/api/focus") { j in
            guard let j = j else { self.draw(); return }
            self.session = j["session"] as? [String: Any]; self.fetchedAt = Date(); self.draw()
        }
    }

    // MARK: display
    func num(_ k: String) -> Double { (session?[k] as? NSNumber)?.doubleValue ?? 0 }
    func str(_ k: String) -> String { session?[k] as? String ?? "" }
    func mmss(_ s: Double) -> String { let v = max(0, Int(s.rounded())); return String(format: "%d:%02d", v / 60, v % 60) }
    func liveSec() -> Double {
        let st = str("state"), base = num("activeSec")
        return st == "active" ? min(num("capMin") * 60, base + Date().timeIntervalSince(fetchedAt)) : base
    }
    func clock() -> String {
        let st = str("state")
        if st == "break" {
            let until = ISO8601DateFormatter().date(from: str("breakUntil")) ?? Date()
            return mmss(until.timeIntervalSinceNow)
        }
        if st == "review" { return "done?" }
        let sec = liveSec(), planned = num("plannedMin") * 60, cap = num("capMin") * 60
        return planned < cap && sec < planned ? mmss(planned - sec) : mmss(cap - sec)
    }
    func draw() {
        guard let b = item.button else { return }
        let st = str("state")
        let symbol: String
        switch st {
        case "active": symbol = "timer"
        case "paused": symbol = "pause.circle"
        case "break": symbol = "cup.and.saucer"
        case "review": symbol = "checkmark.circle"
        default: symbol = online ? "scope" : "exclamationmark.triangle"
        }
        b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Game Plan")
        b.title = session == nil ? "" : " " + clock()
        b.toolTip = session == nil ? (online ? "Game Plan: no block running (⌥⌘G opens it)" : "Game Plan isn't running") : "\(str("title")): \(str("step"))"
    }

    // MARK: menu
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        func add(_ title: String, _ sel: Selector?, _ key: String = "") {
            let m = NSMenuItem(title: title, action: sel, keyEquivalent: key); m.target = self; m.isEnabled = sel != nil; menu.addItem(m)
        }
        if !online { add("Game Plan isn't running", nil); add("Open Game Plan", #selector(openApp), "o"); menu.addItem(.separator()); add("Quit", #selector(quit), "q"); return }
        if let _ = session {
            add(str("title"), nil)
            let step = str("step"); if !step.isEmpty { add("  " + (step.count > 60 ? String(step.prefix(58)) + "…" : step), nil) }
            menu.addItem(.separator())
            switch str("state") {
            case "active":
                if (session?["offer"] as? Bool) == true { add("Keep going (\(Int(num("capMin") - num("plannedMin"))) more min)", #selector(extend)) }
                add("Pause", #selector(pause), "p"); add("Take a 5-min break", #selector(brk)); add("Finish block", #selector(finish), "f")
            case "paused", "break":
                add(str("state") == "break" ? "Back to work" : "Resume", #selector(resume), "r"); add("Finish block", #selector(finish), "f")
            default:
                add("Record what moved forward…", #selector(openApp))
            }
            menu.addItem(.separator())
        } else {
            add("No block running", nil)
            add("Start my next step…", #selector(promptStart))
            menu.addItem(.separator())
        }
        add("Open Game Plan  (⌥⌘G)", #selector(openApp), "o")
        add("Snooze prompts 15 min", #selector(snooze))
        menu.addItem(.separator())
        add("Quit menu bar timer", #selector(quit), "q")
    }
    @objc func pause() { send("pause") }
    @objc func resume() { send("resume") }
    @objc func extend() { send("extend") }
    @objc func finish() { send("finish") { _ in self.open("") } }
    @objc func brk() { send("break", ["minutes": 5]) }
    @objc func snooze() { call("POST", "/api/settings", ["snoozeMin": 15]) }
    @objc func promptStart() { open("?prompt=start") }
    @objc func openApp() { open("") }
    @objc func quit() { NSApp.terminate(nil) }

    func open(_ query: String) {
        let url = BASE + "/" + query
        if NO_OPEN { log("would open \(url)"); return }
        let chrome = "/Applications/Google Chrome.app"
        if FileManager.default.fileExists(atPath: chrome) {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            p.arguments = ["-na", chrome, "--args", "--app=" + url]; try? p.run()
        } else if let u = URL(string: url) { NSWorkspace.shared.open(u) }
    }

    // MARK: lock / sleep / unlock / wake
    @objc func locked() { log("locked"); send("lock") }
    @objc func sleeping() { log("sleep"); send("sleep") }
    @objc func unlocked() { log("unlocked"); askPrompt("unlock") }
    @objc func woke() { log("wake"); askPrompt("wake") }
    func askPrompt(_ action: String) {
        // give Wi-Fi/the server a moment after wake
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.send(action) { j in
                guard let kind = j?["prompt"] as? String else { log("no prompt"); return }
                log("prompt: \(kind)")
                self.open("?prompt=" + kind)
            }
        }
    }

    // MARK: ⌥⌘G
    func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { (NSApp.delegate as? Bar)?.openApp() }
            return noErr
        }, 1, &spec, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x47504C4E), id: 1)
        RegisterEventHotKey(UInt32(kVK_ANSI_G), UInt32(cmdKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
    }
}

let app = NSApplication.shared
let bar = Bar()
app.delegate = bar
app.setActivationPolicy(.accessory)
app.run()
