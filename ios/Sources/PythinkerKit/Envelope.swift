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

public struct DecodedResponse: Equatable, Sendable {
  public let outcome: APIOutcome
  public let closesSheet: Bool
  public let retried: Bool

  public init(outcome: APIOutcome, closesSheet: Bool, retried: Bool) {
    self.outcome = outcome
    self.closesSheet = closesSheet
    self.retried = retried
  }
}

private struct LooseEnvelope: Decodable {
  let code: Int
  let msg: String
}

public enum ResponsePath {
  public static func decode(status: Int, body: Data, dismiss: Bool) -> DecodedResponse {
    let httpFailed = status >= 400
    guard let envelope = try? JSONDecoder().decode(LooseEnvelope.self, from: body) else {
      let code = httpFailed ? status : -1
      let message = httpFailed ? "HTTP \(status)" : "Bad response"
      return DecodedResponse(
        outcome: .failure(code: code, message: message),
        closesSheet: false,
        retried: false
      )
    }
    let outcome = EnvelopeRules.outcome(
      code: envelope.code, message: envelope.msg, dismiss: dismiss)
    if httpFailed {
      if dismiss && envelope.code == EnvelopeRules.questionDismissSuccess {
        return DecodedResponse(outcome: .success, closesSheet: false, retried: false)
      }
      if envelope.code == EnvelopeRules.alreadyResolved {
        return DecodedResponse(outcome: .alreadyResolved, closesSheet: true, retried: false)
      }
      let message = envelope.msg.isEmpty ? "HTTP \(status)" : envelope.msg
      let code = envelope.code == 0 ? status : envelope.code
      return DecodedResponse(
        outcome: .failure(code: code, message: message),
        closesSheet: false,
        retried: false
      )
    }
    return DecodedResponse(
      outcome: outcome,
      closesSheet: outcome == .alreadyResolved,
      retried: false
    )
  }
}
