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

public struct ControlHTTPResult: Equatable, Sendable {
    public let status: Int
    public let body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

public protocol GatewayTransport: Sendable {
    func perform(_ request: ControlRequest, to base: RemoteBase) async throws -> ControlHTTPResult
}

public enum ControlBuildError: Error, Equatable {
    case rejectedID(String)
    case encoding
    case badResponse
}

public enum ApprovalDecision: String, Equatable, Sendable {
    case approved
    case rejected
    case cancelled
}

public enum ControlAction: Equatable, Sendable {
    case prompt(sessionID: String, text: String)
    case abort(sessionID: String)
    case approve(sessionID: String, approvalID: String, decision: String, scope: String?)
    case answer(sessionID: String, questionID: String, itemID: String, optionID: String)
    case dismiss(sessionID: String, questionID: String)

    public func request() throws -> ControlRequest {
        switch self {
        case .prompt(let sessionID, let text):
            let id = try ResourceID.segment(sessionID)
            let body = try JSONBody.data([
                "content": [
                    [
                        "type": "text",
                        "text": text,
                    ],
                ],
            ])
            return ControlRequest(method: "POST", path: "/sessions/\(id)/prompts", body: body)
        case .abort(let sessionID):
            let id = try ResourceID.segment(sessionID)
            return ControlRequest(method: "POST", path: "/sessions/\(id):abort", body: nil)
        case .approve(let sessionID, let approvalID, let decision, let scope):
            let session = try ResourceID.segment(sessionID)
            let approval = try ResourceID.segment(approvalID)
            var object: [String: Any] = ["decision": decision]
            if let scope {
                object["scope"] = scope
            }
            let body = try JSONBody.data(object)
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(session)/approvals/\(approval)",
                body: body
            )
        case .answer(let sessionID, let questionID, let itemID, let optionID):
            let session = try ResourceID.segment(sessionID)
            let question = try ResourceID.segment(questionID)
            _ = try ResourceID.segment(itemID)
            let body = try JSONBody.data([
                "answers": [
                    itemID: [
                        "kind": "single",
                        "option_id": optionID,
                    ],
                ],
            ])
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(session)/questions/\(question)",
                body: body
            )
        case .dismiss(let sessionID, let questionID):
            let session = try ResourceID.segment(sessionID)
            let question = try ResourceID.segment(questionID)
            let body = try JSONBody.data([:])
            return ControlRequest(
                method: "POST",
                path: "/sessions/\(session)/questions/\(question):dismiss",
                body: body
            )
        }
    }
}

public enum RequestURL {
    public static func make(base: RemoteBase, path: String) throws -> URL {
        let suffix = path.hasPrefix("/") ? path : "/" + path
        guard let url = URL(string: base.restRoot.absoluteString + suffix) else {
            throw LinkParseError.notAURL
        }
        return url
    }
}

public struct LiveControlTransport: GatewayTransport {
    public init() {}

    public func perform(_ request: ControlRequest, to base: RemoteBase) async throws -> ControlHTTPResult {
        let http = try Self.makeURLRequest(request, to: base)
        let (data, response) = try await URLSession.shared.data(for: http)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return ControlHTTPResult(status: status, body: data)
    }

    public static func makeURLRequest(_ request: ControlRequest, to base: RemoteBase) throws -> URLRequest {
        let url = try RequestURL.make(base: base, path: request.path)
        var http = URLRequest(url: url)
        http.httpMethod = request.method
        http.httpBody = request.body
        if request.body != nil {
            http.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return http
    }
}

public enum ControlTransport {
    public static func send(_ request: ControlRequest, to base: RemoteBase) async throws -> (Data, URLResponse) {
        let http = try LiveControlTransport.makeURLRequest(request, to: base)
        return try await URLSession.shared.data(for: http)
    }
}

enum ResourceID {
    static func segment(_ id: String) throws -> String {
        if id.isEmpty || id.contains("/") || id.contains("..") {
            throw ControlBuildError.rejectedID(id)
        }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw ControlBuildError.rejectedID(id)
        }
        return encoded
    }
}

enum JSONBody {
    static func data(_ object: [String: Any]) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw ControlBuildError.encoding
        }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}
