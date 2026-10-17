import Foundation

public enum VersionGateError: Error, Equatable {
  case unknown(String)
}

public enum VersionGate {
  public static let acceptedServerVersion = "0.2.5"

  public static func accept(_ version: String, known: Set<String>) throws {
    guard known.contains(version) else {
      throw VersionGateError.unknown(version)
    }
  }

  public static func acceptPinned(_ version: String) throws {
    try accept(version, known: [acceptedServerVersion])
  }
}
