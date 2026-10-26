// "Run air conditioner action" for Shortcuts automations, so schedules run at exact times with the
// app closed. Actions are saved by the app (src/shortcuts.ts) as ready-made ECHONET Lite frames.
import AppIntents
internal import EchonetUdp
import Foundation

private struct Saved: Codable {
  struct Device: Codable { let id: String; var ip: String; let ident: String }
  struct Action: Codable {
    let id: String
    let title: String
    let deviceId: String
    let frames: [String]
    let enabled: Bool
    let days: [Int]? // 0 = Sunday; nil = any day
  }
  var devices: [Device]
  var actions: [Action]

  static func load() -> Saved? {
    guard let json = UserDefaults.standard.string(forKey: "cocoro.shortcuts") else { return nil }
    return try? JSONDecoder().decode(Saved.self, from: Data(json.utf8))
  }

  func save() {
    if let data = try? JSONEncoder().encode(self) {
      UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: "cocoro.shortcuts")
    }
  }
}

struct AirConditionerAction: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Air conditioner action"
  static let defaultQuery = AirConditionerActionQuery()
  let id: String
  let title: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct AirConditionerActionQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [AirConditionerAction] {
    try await suggestedEntities().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [AirConditionerAction] {
    (Saved.load()?.actions ?? []).map { AirConditionerAction(id: $0.id, title: $0.title) }
  }
}

struct RunAirConditionerAction: AppIntent {
  static let title: LocalizedStringResource = "Run air conditioner action"
  static let description = IntentDescription("Sends a saved Cocoro Air Pro action or schedule to your air conditioner over your home Wi‑Fi.")
  static let openAppWhenRun = false

  @Parameter(title: "Action")
  var action: AirConditionerAction

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let message = try ActionRunner.run(action.id)
    return .result(dialog: "\(message)")
  }
}

struct CocoroShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: RunAirConditionerAction(), phrases: ["Run an air conditioner action in \(.applicationName)"])
  }
}

private enum ActionRunner {
  static func run(_ actionId: String) throws -> String {
    guard var saved = Saved.load(), let action = saved.actions.first(where: { $0.id == actionId }),
          let index = saved.devices.firstIndex(where: { $0.id == action.deviceId }) else {
      throw UdpError("This action no longer exists. Open Cocoro Air Pro to update your schedules.")
    }
    // The schedule's on/off switch and days live in the app, so Shortcuts only needs a daily trigger.
    if !action.enabled { return "\(action.title) is switched off in Cocoro Air Pro." }
    if let days = action.days, !days.contains(Calendar.current.component(.weekday, from: Date()) - 1) {
      return "\(action.title) isn't set for today."
    }
    if action.frames.isEmpty { throw UdpError("Open Cocoro Air Pro on your home Wi‑Fi once, then try again.") }

    var ip = saved.devices[index].ip
    for frame in action.frames {
      if try send(frame, to: ip) { continue }
      // No answer: the router may have given the unit a new address. Find it by its identification number.
      guard let found = find(ident: saved.devices[index].ident), found != ip, try send(frame, to: found) else {
        throw UdpError("The air conditioner didn't answer. Is this iPhone on your home Wi‑Fi?")
      }
      ip = found
      saved.devices[index].ip = found
      saved.save()
    }
    var runs = (try? JSONSerialization.jsonObject(with: Data((UserDefaults.standard.string(forKey: "cocoro.runs") ?? "{}").utf8))) as? [String: String] ?? [:]
    runs[actionId] = ISO8601DateFormatter().string(from: Date())
    if let data = try? JSONSerialization.data(withJSONObject: runs) {
      UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: "cocoro.runs")
    }
    return "Done: \(action.title)"
  }

  /// true when the unit confirmed (Set_Res 0x71), false when it didn't answer; throws if it refused.
  private static func send(_ hex: String, to ip: String) throws -> Bool {
    let replies = try EchonetUdpModule.run(hosts: [ip], payload: EchonetUdpModule.bytes(hex), timeoutMs: 2500, stopAfter: 1)
    guard let reply = replies.first?.split(separator: " ").last else { return false }
    let bytes = EchonetUdpModule.bytes(String(reply))
    if bytes.count > 10, bytes[10] == 0x51 { throw UdpError("The air conditioner refused that setting.") }
    return bytes.count > 10 && bytes[10] == 0x71
  }

  private static func find(ident: String) -> String? {
    guard !ident.isEmpty, let me = EchonetUdpModule.wifiAddress() else { return nil }
    let base = me.split(separator: ".").prefix(3).joined(separator: ".")
    let hosts = (1...254).map { "\(base).\($0)" }.filter { $0 != me }
    let getIdent = "1081000105ff0101300162018300" // Get 0x83 (identification number) from the air conditioner
    for reply in (try? EchonetUdpModule.run(hosts: hosts, payload: EchonetUdpModule.bytes(getIdent), timeoutMs: 3000, stopAfter: 0)) ?? [] {
      let parts = reply.split(separator: " ")
      if parts.count == 2, parts[1].contains(ident) { return String(parts[0]) }
    }
    return nil
  }
}
