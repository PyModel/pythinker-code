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

public enum QuestionAnswer: Equatable, Sendable {
  case single(optionID: String)
  case multi(optionIDs: [String])
  case other(text: String)
  case multiWithOther(optionIDs: [String], text: String)

  var json: [String: Any] {
    switch self {
    case .single(let optionID):
      return ["kind": "single", "option_id": optionID]
    case .multi(let optionIDs):
      return ["kind": "multi", "option_ids": optionIDs]
    case .other(let text):
      return ["kind": "other", "text": text]
    case .multiWithOther(let optionIDs, let text):
      return ["kind": "multi_with_other", "option_ids": optionIDs, "other_text": text]
    }
  }
}

public enum ControlAction: Equatable, Sendable {
  case prompt(sessionID: String, text: String, promptID: String)
  case abort(sessionID: String)
  case approve(sessionID: String, approvalID: String, decision: String, scope: String?)
  case answer(sessionID: String, questionID: String, answers: [String: QuestionAnswer])
  case dismiss(sessionID: String, questionID: String)

  public func request() throws -> ControlRequest {
    switch self {
    case .prompt(let sessionID, let text, let promptID):
      let id = try ResourceID.segment(sessionID)
      guard !promptID.isEmpty else { throw ControlBuildError.rejectedID(promptID) }
      let body = try JSONBody.data([
        "content": [
          [
            "type": "text",
            "text": text,
          ]
        ],
        "prompt_id": promptID,
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
    case .answer(let sessionID, let questionID, let answers):
      let session = try ResourceID.segment(sessionID)
      let question = try ResourceID.segment(questionID)
      guard !answers.isEmpty, !answers.keys.contains(where: \.isEmpty) else {
        throw ControlBuildError.rejectedID("")
      }
      let body = try JSONBody.data(["answers": answers.mapValues(\.json)])
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
  private let session: URLSession

  public init(session: URLSession = PhoneHTTP.makeSession()) {
    self.session = session
  }

  public func perform(_ request: ControlRequest, to base: RemoteBase) async throws
    -> ControlHTTPResult
  {
    let http = try Self.makeURLRequest(request, to: base)
    let (data, response) = try await session.data(for: http)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    return ControlHTTPResult(status: status, body: data)
  }

  public static func makeURLRequest(_ request: ControlRequest, to base: RemoteBase) throws
    -> URLRequest
  {
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

enum ResourceID {
  static func segment(_ id: String) throws -> String {
    if id.isEmpty || id == "." || id == ".." || id.contains("/") {
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
