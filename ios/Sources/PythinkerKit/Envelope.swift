import Foundation

public struct APIEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    public let code: Int
    public let msg: String
    public let data: T?

    public init(code: Int, msg: String, data: T?) {
        self.code = code
        self.msg = msg
        self.data = data
    }
}

public enum APIOutcome: Equatable, Sendable {
    case success
    case alreadyResolved
    case failure(code: Int, message: String)
}

public enum EnvelopeRules {
    public static let questionDismissSuccess = 40909
    public static let alreadyResolved = 40902

    public static func outcome(code: Int, message: String, dismiss: Bool) -> APIOutcome {
        if code == 0 { return .success }
        if dismiss && code == questionDismissSuccess { return .success }
        if code == alreadyResolved { return .alreadyResolved }
        return .failure(code: code, message: message)
    }
}
