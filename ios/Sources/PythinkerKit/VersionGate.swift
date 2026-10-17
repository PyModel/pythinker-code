import Foundation

public enum VersionGateError: Error, Equatable {
  case missingVersion
  case unsupported(version: String)
}

public struct ServerMeta: Equatable, Sendable {
  public let serverVersion: String
  public let backend: String?
  public let websocket: Bool

  public init(serverVersion: String, backend: String?, websocket: Bool) {
    self.serverVersion = serverVersion
    self.backend = backend
    self.websocket = websocket
  }
}

public enum VersionGate {
  public static let requiredBackend = "v2"

  public static func accept(_ meta: ServerMeta) throws {
    guard !meta.serverVersion.isEmpty else { throw VersionGateError.missingVersion }
    guard meta.backend == requiredBackend, meta.websocket else {
      throw VersionGateError.unsupported(version: meta.serverVersion)
    }
  }
}
