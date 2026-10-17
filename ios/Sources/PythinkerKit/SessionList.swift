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
    public static func subscribe(sessionIDs: [String], cursors: [String: SubscribeCursor]) -> String {
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
            "id": "1",
            "payload": payload,
        ]
        let data = try! JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
