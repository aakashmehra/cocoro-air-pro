import Darwin
import ExpoModulesCore

@ExpoModule("EchonetUdp")
public class EchonetUdpModule: Module {
  // Serial: every exchange binds UDP 3610 (ECHONET replies go to that port), so one at a time.
  private static let queue = DispatchQueue(label: "echonet-udp")

  @JS(.concurrent)
  func exchange(hosts: [String], hex: String, timeoutMs: Int, stopAfter: Int) async throws -> [String] {
    let payload = Self.bytes(hex)
    return try await withCheckedThrowingContinuation { cont in
      Self.queue.async {
        do { cont.resume(returning: try Self.run(hosts: hosts, payload: payload, timeoutMs: timeoutMs, stopAfter: stopAfter)) }
        catch { cont.resume(throwing: error) }
      }
    }
  }

  /// Plain HTTP for first-time Wi-Fi setup on the unit's own network. Never uses mobile data: that
  /// network has no internet, and iOS would otherwise send `aiot.sharp` out over cellular.
  /// `headers` is flat [name, value, ...]. Returns [status, body hex].
  @JS(.concurrent)
  func http(method: String, url: String, headers: [String], bodyHex: String, timeoutMs: Int) async throws -> [String] {
    guard let target = URL(string: url) else { throw UdpError("Bad address") }
    var req = URLRequest(url: target, timeoutInterval: Double(timeoutMs) / 1000)
    req.httpMethod = method
    for i in stride(from: 0, to: headers.count - 1, by: 2) { req.setValue(headers[i + 1], forHTTPHeaderField: headers[i]) }
    if !bodyHex.isEmpty { req.httpBody = Data(Self.bytes(bodyHex)) }
    let config = URLSessionConfiguration.ephemeral
    config.allowsCellularAccess = false
    config.waitsForConnectivity = false
    let session = URLSession(configuration: config)
    defer { session.finishTasksAndInvalidate() }
    let (data, res) = try await session.data(for: req)
    return [String((res as? HTTPURLResponse)?.statusCode ?? 0), data.map { String(format: "%02x", $0) }.joined()]
  }

  public static func bytes(_ hex: String) -> [UInt8] {
    stride(from: 0, to: hex.count - 1, by: 2).compactMap { i -> UInt8? in
      let start = hex.index(hex.startIndex, offsetBy: i)
      return UInt8(hex[start..<hex.index(start, offsetBy: 2)], radix: 16)
    }
  }

  @JS
  nonisolated func localIp() -> String? { Self.wifiAddress() }

  /// Saved actions for the "Run air conditioner action" Shortcuts action (JSON written by the app).
  @JS
  nonisolated func setShortcutData(json: String) {
    UserDefaults.standard.set(json, forKey: "cocoro.shortcuts")
  }

  /// When each action last ran from Shortcuts: JSON {actionId: ISO time}.
  @JS
  nonisolated func shortcutRuns() -> String {
    UserDefaults.standard.string(forKey: "cocoro.runs") ?? "{}"
  }

  public static func wifiAddress() -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let ifa = ptr.pointee
      guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET), String(cString: ifa.ifa_name) == "en0" else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        return String(cString: host)
      }
    }
    return nil
  }

  public static func run(hosts: [String], payload: [UInt8], timeoutMs: Int, stopAfter: Int) throws -> [String] {
    let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    guard fd >= 0 else { throw UdpError("Could not open a network socket (\(errno))") }
    defer { close(fd) }
    var one: Int32 = 1
    let size = socklen_t(MemoryLayout<Int32>.size)
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, size)
    setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, size)

    var local = sockaddr_in()
    local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    local.sin_family = sa_family_t(AF_INET)
    local.sin_port = in_port_t(3610).bigEndian
    local.sin_addr.s_addr = INADDR_ANY
    let addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafePointer(to: &local) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, addrLen) } }
    guard bound == 0 else { throw UdpError("Could not listen on the local network (\(errno))") }

    for host in hosts {
      var dst = local
      guard inet_pton(AF_INET, host, &dst.sin_addr) == 1 else { continue }
      _ = payload.withUnsafeBytes { buf in
        withUnsafePointer(to: &dst) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, buf.baseAddress, buf.count, 0, $0, addrLen) } }
      }
    }

    var replies: [String] = []
    var buf = [UInt8](repeating: 0, count: 1500)
    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
    while stopAfter == 0 || replies.count < stopAfter {
      let left = Int32(deadline.timeIntervalSinceNow * 1000)
      if left <= 0 { break }
      var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
      if poll(&pfd, 1, left) <= 0 { break }
      var src = sockaddr_in()
      var srcLen = addrLen
      let n = withUnsafeMutablePointer(to: &src) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &srcLen) } }
      guard n > 0 else { continue }
      var ip = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
      inet_ntop(AF_INET, &src.sin_addr, &ip, socklen_t(INET_ADDRSTRLEN))
      replies.append(String(cString: ip) + " " + buf[0..<n].map { String(format: "%02x", $0) }.joined())
    }
    return replies
  }
}

public struct UdpError: LocalizedError {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}
