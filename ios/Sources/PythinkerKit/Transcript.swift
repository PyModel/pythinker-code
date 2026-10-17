import Foundation

public struct ToolCard: Equatable, Sendable, Identifiable {
    public let id: String
    public var name: String
    public var status: String

    public init(id: String, name: String, status: String) {
        self.id = id
        self.name = name
        self.status = status
    }
}

public enum FrameEffect: Equatable, Sendable {
    case applied
    case ignored
    case resync
}

public struct SessionTranscript: Equatable, Sendable {
    public var committedText: String
    public var liveText: String
    public var cursor: StreamCursor
    public var tools: [ToolCard]

    public init(
        committedText: String = "",
        liveText: String = "",
        cursor: StreamCursor = StreamCursor(),
        tools: [ToolCard] = []
    ) {
        self.committedText = committedText
        self.liveText = liveText
        self.cursor = cursor
        self.tools = tools
    }

    public var assistantText: String {
        if committedText.isEmpty { return liveText }
        if liveText.isEmpty { return committedText }
        return committedText + "\n" + liveText
    }

    public mutating func applyDelta(offset: Int, chunk: String) -> Bool {
        guard cursor.apply(offset: offset, chunk: chunk) else { return false }
        liveText += chunk
        return true
    }

    public mutating func apply(frame text: String) -> FrameEffect {
        guard let data = text.data(using: .utf8),
            let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = frame["type"] as? String
        else {
            return .ignored
        }
        if type == "resync_required" { return .resync }
        let payload = frame["payload"] as? [String: Any] ?? [:]
        switch type {
        case "assistant.delta":
            let offset = JSONValue.int(frame["offset"]) ?? cursor.textLength
            let chunk = payload["delta"] as? String ?? ""
            if offset > cursor.textLength { return .resync }
            return applyDelta(offset: offset, chunk: chunk) ? .applied : .ignored
        case "tool.call.started":
            let id = payload["toolCallId"] as? String ?? ""
            let name = payload["name"] as? String ?? ""
            guard !id.isEmpty, !name.isEmpty else { return .ignored }
            upsert(id: id, name: name, status: "running")
            return .applied
        case "tool.result":
            let id = payload["toolCallId"] as? String ?? ""
            guard !id.isEmpty else { return .ignored }
            let failed = payload["isError"] as? Bool ?? false
            upsert(id: id, name: name(for: id), status: failed ? "failed" : "done")
            return .applied
        default:
            return .ignored
        }
    }

    private mutating func upsert(id: String, name: String, status: String) {
        if let index = tools.firstIndex(where: { $0.id == id }) {
            if !name.isEmpty { tools[index].name = name }
            tools[index].status = status
        } else {
            tools.append(ToolCard(id: id, name: name.isEmpty ? "tool" : name, status: status))
        }
    }

    private func name(for id: String) -> String {
        tools.first { $0.id == id }?.name ?? "tool"
    }
}

public struct SnapshotView: Equatable, Sendable {
    public let asOfSeq: Int
    public let epoch: String
    public let transcript: SessionTranscript
    public let approval: ApprovalDraft?
    public let question: PendingQuestion?

    public init(
        asOfSeq: Int,
        epoch: String,
        transcript: SessionTranscript,
        approval: ApprovalDraft?,
        question: PendingQuestion?
    ) {
        self.asOfSeq = asOfSeq
        self.epoch = epoch
        self.transcript = transcript
        self.approval = approval
        self.question = question
    }
}

enum SnapshotDecoder {
    static func decode(_ body: Data) throws -> SnapshotView {
        guard let root = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw ControlBuildError.badResponse
        }
        let code = JSONValue.int(root["code"]) ?? -1
        let message = root["msg"] as? String ?? ""
        let outcome = EnvelopeRules.outcome(code: code, message: message, dismiss: false)
        guard case .success = outcome, let data = root["data"] as? [String: Any] else {
            throw ControlBuildError.badResponse
        }
        guard let epoch = data["epoch"] as? String, !epoch.isEmpty else {
            throw ControlBuildError.badResponse
        }
        let seq = JSONValue.int(data["as_of_seq"]) ?? 0
        return SnapshotView(
            asOfSeq: seq,
            epoch: epoch,
            transcript: transcript(from: data),
            approval: approval(from: data),
            question: question(from: data)
        )
    }

    private static func transcript(from data: [String: Any]) -> SessionTranscript {
        var committed: [String] = []
        var tools: [ToolCard] = []
        var failed: [String: Bool] = [:]
        if let messages = data["messages"] as? [String: Any],
            let items = messages["items"] as? [[String: Any]]
        {
            for item in items.reversed() {
                guard let content = item["content"] as? [[String: Any]] else { continue }
                for part in content {
                    switch part["type"] as? String {
                    case "text":
                        if let text = part["text"] as? String, !text.isEmpty {
                            committed.append(text)
                        }
                    case "tool_use":
                        let id = part["tool_call_id"] as? String ?? "tool-\(tools.count)"
                        let name = part["tool_name"] as? String ?? "tool"
                        tools.append(ToolCard(id: id, name: name, status: "done"))
                    case "tool_result":
                        if let id = part["tool_call_id"] as? String {
                            failed[id] = part["is_error"] as? Bool ?? false
                        }
                    default:
                        break
                    }
                }
            }
        }
        for index in tools.indices {
            if failed[tools[index].id] == true {
                tools[index].status = "failed"
            }
        }
        var live = ""
        if let turn = data["in_flight_turn"] as? [String: Any] {
            live = turn["assistant_text"] as? String ?? ""
            if let running = turn["running_tools"] as? [[String: Any]] {
                for tool in running {
                    let id = tool["tool_call_id"] as? String ?? "tool-\(tools.count)"
                    let name = tool["name"] as? String ?? "tool"
                    if let index = tools.firstIndex(where: { $0.id == id }) {
                        tools[index].status = "running"
                        tools[index].name = name
                    } else {
                        tools.append(ToolCard(id: id, name: name, status: "running"))
                    }
                }
            }
        }
        return SessionTranscript(
            committedText: committed.joined(separator: "\n"),
            liveText: live,
            cursor: StreamCursor(textLength: live.count),
            tools: tools
        )
    }

    private static func approval(from data: [String: Any]) -> ApprovalDraft? {
        guard let items = data["pending_approvals"] as? [[String: Any]], let first = items.first else {
            return nil
        }
        let id = first["approval_id"] as? String ?? ""
        guard !id.isEmpty else { return nil }
        return ApprovalDraft(
            toolName: first["tool_name"] as? String ?? "",
            action: first["action"] as? String ?? "",
            inputDisplay: DisplayText.string(first["tool_input_display"]),
            id: id
        )
    }

    private static func question(from data: [String: Any]) -> PendingQuestion? {
        guard let items = data["pending_questions"] as? [[String: Any]], let first = items.first else {
            return nil
        }
        let id = first["question_id"] as? String ?? ""
        guard !id.isEmpty else { return nil }
        let rawItems = first["questions"] as? [[String: Any]] ?? []
        let parsed = rawItems.compactMap { item -> QuestionItem? in
            guard let itemID = item["id"] as? String else { return nil }
            let options = (item["options"] as? [[String: Any]] ?? []).compactMap { option -> QuestionOption? in
                guard let optionID = option["id"] as? String else { return nil }
                return QuestionOption(id: optionID, label: option["label"] as? String ?? optionID)
            }
            return QuestionItem(id: itemID, prompt: item["question"] as? String ?? "", options: options)
        }
        return PendingQuestion(id: id, items: parsed)
    }
}

enum DisplayText {
    static func string(_ value: Any?) -> String {
        if let text = value as? String { return text }
        guard let object = value as? [String: Any] else { return "" }
        for key in ["command", "path", "query", "url", "prompt", "detail"] {
            if let text = object[key] as? String, !text.isEmpty { return text }
        }
        guard JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return text
    }
}

enum JSONValue {
    static func int(_ value: Any?) -> Int? {
        if let number = value as? Int { return number }
        if let number = value as? NSNumber { return number.intValue }
        return nil
    }
}
