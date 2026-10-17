import Foundation

public enum VersionGateError: Error, Equatable {
    case unknown(String)
}

public enum VersionGate {
    public static func accept(_ version: String, known: Set<String>) throws {
        guard known.contains(version) else {
            throw VersionGateError.unknown(version)
        }
    }
}
