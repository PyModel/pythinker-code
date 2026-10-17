import Foundation

public struct SessionFacts: Decodable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let busy: Bool
  public let pendingInteraction: String?
  public let lastTurnReason: String?

  enum CodingKeys: String, CodingKey {
    case id
    case title
    case busy
    case pendingInteraction = "pending_interaction"
    case lastTurnReason = "last_turn_reason"
  }

  public var activity: String {
    if pendingInteraction == "approval" { return "approval" }
    if pendingInteraction == "question" { return "question" }
    if !busy && lastTurnReason == "failed" { return "failed" }
    if busy { return "running" }
    return "idle"
  }

  public var row: SessionRow {
    SessionRow(id: id, title: title, activity: activity)
  }
}

public struct SessionPage: Decodable, Equatable, Sendable {
  public let items: [SessionFacts]
}

public struct SubscribeCursor: Equatable, Sendable {
  public let seq: Int
  public let epoch: String

  public init(seq: Int, epoch: String) {
    self.seq = seq
    self.epoch = epoch
  }
}

public enum SocketFrames {
  public static func subscribe(
    id: String, sessionIDs: [String], cursors: [String: SubscribeCursor]
  ) throws -> String {
    var cursorObject: [String: [String: Any]] = [:]
    for (id, cursor) in cursors {
      cursorObject[id] = ["seq": cursor.seq, "epoch": cursor.epoch]
    }
    let payload: [String: Any] = [
      "session_ids": sessionIDs,
      "cursors": cursorObject,
    ]
    let frame: [String: Any] = [
      "type": "subscribe",
      "id": id,
      "payload": payload,
    ]
    let data: Data
    do {
      data = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys])
    } catch {
      throw SocketFrameError.encoding
    }
    guard let text = String(data: data, encoding: .utf8) else {
      throw SocketFrameError.encoding
    }
    return text
  }

  public static func keepalive() -> String {
    #"{"type":"pong","payload":{"nonce":""}}"#
  }

  public static func pong(for frame: String) -> String? {
    guard let data = frame.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["type"] as? String == "ping"
    else {
      return nil
    }
    let payload = object["payload"] as? [String: Any]
    let nonce = payload?["nonce"] as? String ?? ""
    let reply: [String: Any] = [
      "type": "pong",
      "payload": ["nonce": nonce],
    ]
    guard let encoded = try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys]),
      let text = String(data: encoded, encoding: .utf8)
    else {
      return nil
    }
    return text
  }
}

enum SessionListDecoder {
  static func rows(status: Int, body: Data) throws -> [SessionRow] {
    let decoded = ResponsePath.decode(status: status, body: body, dismiss: false)
    guard case .success = decoded.outcome else {
      throw ControlBuildError.badResponse
    }
    let page = try JSONDecoder().decode(APIEnvelope<SessionPage>.self, from: body)
    guard let items = page.data?.items else {
      throw ControlBuildError.badResponse
    }
    return items.map(\.row)
  }
}

enum MetaRead {
  static func meta(status: Int, body: Data) throws -> ServerMeta {
    let decoded = ResponsePath.decode(status: status, body: body, dismiss: false)
    guard case .success = decoded.outcome else {
      throw ControlBuildError.badResponse
    }
    guard let root = try JSONSerialization.jsonObject(with: body) as? [String: Any],
      let data = root["data"] as? [String: Any]
    else {
      throw ControlBuildError.badResponse
    }
    let capabilities = data["capabilities"] as? [String: Any]
    return ServerMeta(
      serverVersion: data["server_version"] as? String ?? "",
      backend: data["backend"] as? String,
      websocket: capabilities?["websocket"] as? Bool ?? false
    )
  }
}
