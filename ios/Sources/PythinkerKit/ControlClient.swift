import Foundation

public struct ControlRequest: Equatable, Sendable {
    public let method: String
    public let path: String
    public let body: Data?

    public init(method: String, path: String, body: Data?) {
        self.method = method
        self.path = path
        self.body = body
    }
}

public enum ControlAction: Equatable, Sendable {
    case prompt(sessionID: String, text: String)
    case abort(sessionID: String)
    case approve(sessionID: String, approvalID: String, decision: String)
    case answer(sessionID: String, questionID: String, optionID: String)
    case dismiss(sessionID: String, questionID: String)

    public func request() -> ControlRequest {
        switch self {
        case .prompt(let sessionID, let text):
            let body = Data("{\"content\":[{\"type\":\"text\",\"text\":\(jsonString(text))}]}".utf8)
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(sessionID)/prompts",
                body: body
            )
        case .abort(let sessionID):
            return ControlRequest(method: "POST", path: "/sessions/\(sessionID):abort", body: nil)
        case .approve(let sessionID, let approvalID, let decision):
            let body = Data("{\"decision\":\(jsonString(decision))}".utf8)
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(sessionID)/approvals/\(approvalID)",
                body: body
            )
        case .answer(let sessionID, let questionID, let optionID):
            let body = Data("{\"answers\":{\"q_0\":{\"option_id\":\(jsonString(optionID))}}}".utf8)
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(sessionID)/questions/\(questionID)",
                body: body
            )
        case .dismiss(let sessionID, let questionID):
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(sessionID)/questions/\(questionID):dismiss",
                body: Data("{}".utf8)
            )
        }
    }
}

public enum ControlTransport {
    public static func send(_ request: ControlRequest, to base: RemoteBase) async throws -> (Data, URLResponse) {
        let url = base.restRoot.appending(path: String(request.path.dropFirst()))
        var http = URLRequest(url: url)
        http.httpMethod = request.method
        http.httpBody = request.body
        if request.body != nil {
            http.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return try await URLSession.shared.data(for: http)
    }
}

private func jsonString(_ value: String) -> String {
    let escaped = value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}
