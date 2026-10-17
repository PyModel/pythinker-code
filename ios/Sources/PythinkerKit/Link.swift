import Foundation

public struct RemoteBase: Equatable, Sendable {
    public let base: URL
    public let relayHost: String

    public init(base: URL, relayHost: String) {
        self.base = base
        self.relayHost = relayHost
    }

    public var restRoot: URL {
        base.appending(path: "api/v1")
    }

    public var socketURL: URL {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        parts.scheme = base.scheme == "https" ? "wss" : "ws"
        parts.path = base.path + "/api/v1/ws"
        return parts.url!
    }
}

public enum LinkParseError: Error, Equatable {
    case notAURL
    case missingDevice
}

public enum RemoteLink {
    public static func parse(_ raw: String) throws -> RemoteBase {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed), parts.host != nil else {
            throw LinkParseError.notAURL
        }
        parts.query = nil
        parts.fragment = nil
        var path = parts.path
        while path.hasSuffix("/") {
            path.removeLast()
        }
        guard path.contains("/devices/") else {
            throw LinkParseError.missingDevice
        }
        if let range = path.range(of: "/sessions/") {
            path = String(path[..<range.lowerBound])
        }
        parts.path = path
        guard let base = parts.url, let host = parts.host else {
            throw LinkParseError.notAURL
        }
        return RemoteBase(base: base, relayHost: host)
    }
}
