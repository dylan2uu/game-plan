// Game Plan hotkey: Option-Command-G from anywhere brings up Game Plan.
// Carbon's RegisterEventHotKey works without Accessibility permission. Runs as a LaunchAgent (see install.sh).
import Carbon
import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)   // no Dock icon, no menu

var ref: EventHotKeyRef?
var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    p.arguments = [NSHomeDirectory() + "/Applications/Game Plan.app"]
    try? p.run()
    return noErr
}, 1, &pressed, nil, nil)

let status = RegisterEventHotKey(UInt32(kVK_ANSI_G), UInt32(cmdKey | optionKey),
                                 EventHotKeyID(signature: 0x47504C4E, id: 1), GetApplicationEventTarget(), 0, &ref)
if status != noErr {
    FileHandle.standardError.write("Option-Command-G is already used by another app (\(status)).\n".data(using: .utf8)!)
    exit(0)                            // don't let launchd restart-loop
}
app.run()
