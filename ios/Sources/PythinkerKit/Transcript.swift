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

  public static let maxText = 16_000
  public static let maxTools = 32

  public var assistantText: String {
    if committedText.isEmpty { return liveText }
    if liveText.isEmpty { return committedText }
    return Self.tail(committedText + "\n" + liveText, utf16Limit: Self.maxText)
  }

  public mutating func applyDelta(offset: Int, chunk: String) -> Bool {
    guard cursor.apply(offset: offset, chunk: chunk) else { return false }
    liveText += chunk
    liveText = Self.tail(liveText, utf16Limit: Self.maxText)
    return true
  }

  static func tail(_ text: String, utf16Limit: Int) -> String {
    guard text.utf16.count > utf16Limit else { return text }
    var start = text.endIndex
    var units = 0
    while start > text.startIndex && units < utf16Limit {
      let previous = text.index(before: start)
      let piece = text[previous..<start].utf16.count
      if units + piece > utf16Limit { break }
      units += piece
      start = previous
    }
    return String(text[start...])
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
    if let agent = payload["agentId"] as? String, agent != "main" {
      return .ignored
    }
    switch type {
    case "turn.started", "turn.step.started", "turn.ended":
      commitLive()
      return .applied
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

  private mutating func commitLive() {
    if !liveText.isEmpty {
      if committedText.isEmpty {
        committedText = liveText
      } else {
        committedText += "\n" + liveText
      }
      liveText = ""
      committedText = Self.tail(committedText, utf16Limit: Self.maxText)
    }
    cursor = StreamCursor()
  }

  private mutating func upsert(id: String, name: String, status: String) {
    if let index = tools.firstIndex(where: { $0.id == id }) {
      if !name.isEmpty { tools[index].name = name }
      tools[index].status = status
    } else {
      if tools.count >= Self.maxTools {
        tools.removeFirst()
      }
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
  public let approvals: [ApprovalDraft]
  public let questions: [PendingQuestion]

  public init(
    asOfSeq: Int,
    epoch: String,
    transcript: SessionTranscript,
    approvals: [ApprovalDraft],
    questions: [PendingQuestion]
  ) {
    self.asOfSeq = asOfSeq
    self.epoch = epoch
    self.transcript = transcript
    self.approvals = approvals
    self.questions = questions
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
      approvals: (data["pending_approvals"] as? [[String: Any]] ?? []).compactMap(approvalDraft),
      questions: (data["pending_questions"] as? [[String: Any]] ?? []).compactMap(pendingQuestion)
    )
  }

  private static func transcript(from data: [String: Any]) -> SessionTranscript {
    var committed: [String] = []
    var tools: [ToolCard] = []
    var failed: [String: Bool] = [:]
    if let messages = data["messages"] as? [String: Any],
      let items = messages["items"] as? [[String: Any]]
    {
      for item in items {
        let role = item["role"] as? String
        guard let content = item["content"] as? [[String: Any]] else { continue }
        for part in content {
          switch part["type"] as? String {
          case "text":
            if role == "assistant", let text = part["text"] as? String, !text.isEmpty {
              committed.append(SessionTranscript.tail(text, utf16Limit: SessionTranscript.maxText))
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
    while tools.count > SessionTranscript.maxTools {
      if let index = tools.firstIndex(where: { $0.status != "running" }) {
        tools.remove(at: index)
      } else {
        tools.removeFirst()
      }
    }
    let liveUnits = live.utf16.count
    return SessionTranscript(
      committedText: SessionTranscript.tail(
        committed.joined(separator: "\n"),
        utf16Limit: SessionTranscript.maxText
      ),
      liveText: SessionTranscript.tail(live, utf16Limit: SessionTranscript.maxText),
      cursor: StreamCursor(textLength: liveUnits),
      tools: tools
    )
  }

  static func approvalDraft(_ item: [String: Any]) -> ApprovalDraft? {
    let id = item["approval_id"] as? String ?? ""
    guard !id.isEmpty else { return nil }
    return ApprovalDraft(
      toolName: item["tool_name"] as? String ?? "",
      action: item["action"] as? String ?? "",
      inputDisplay: DisplayText.string(item["tool_input_display"]),
      id: id
    )
  }

  static func pendingQuestion(_ item: [String: Any]) -> PendingQuestion? {
    let id = item["question_id"] as? String ?? ""
    guard !id.isEmpty else { return nil }
    let rawItems = item["questions"] as? [[String: Any]] ?? []
    let parsed = rawItems.compactMap { item -> QuestionItem? in
      guard let itemID = item["id"] as? String else { return nil }
      let options = (item["options"] as? [[String: Any]] ?? []).compactMap {
        option -> QuestionOption? in
        guard let optionID = option["id"] as? String else { return nil }
        return QuestionOption(id: optionID, label: option["label"] as? String ?? optionID)
      }
      return QuestionItem(
        id: itemID,
        prompt: item["question"] as? String ?? "",
        options: options,
        multiSelect: item["multi_select"] as? Bool ?? false,
        allowOther: item["allow_other"] as? Bool ?? false,
        otherLabel: item["other_label"] as? String ?? "Other"
      )
    }
    return PendingQuestion(id: id, items: parsed)
  }
}

enum InteractionFrames {
  static func apply(_ text: String, to state: inout PhoneState) -> Bool {
    guard let data = text.data(using: .utf8),
      let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = frame["type"] as? String
    else {
      return false
    }
    let payload = frame["payload"] as? [String: Any] ?? [:]
    switch type {
    case "event.approval.requested":
      if let draft = SnapshotDecoder.approvalDraft(payload) {
        state.upsertApproval(draft)
      }
      return true
    case "event.approval.resolved":
      if let id = payload["approval_id"] as? String, !id.isEmpty {
        state.dropApproval(id: id)
      }
      return true
    case "event.question.requested":
      if let question = SnapshotDecoder.pendingQuestion(payload) {
        state.upsertQuestion(question)
      }
      return true
    case "event.question.answered", "event.question.dismissed":
      if let id = payload["question_id"] as? String, !id.isEmpty {
        state.dropQuestion(id: id)
      }
      return true
    default:
      return false
    }
  }
}

enum DisplayText {
  static let maxUnits = 4_000

  static func string(_ value: Any?) -> String {
    if let text = value as? String { return clip(text) }
    guard let object = value as? [String: Any] else { return "" }
    return clip(render(object))
  }

  static func clip(_ text: String) -> String {
    let units = text.utf16.count
    guard units > maxUnits else { return text }
    var end = text.startIndex
    var used = 0
    while end < text.endIndex {
      let next = text.index(after: end)
      let piece = text[end..<next].utf16.count
      if used + piece > maxUnits { break }
      used += piece
      end = next
    }
    return String(text[..<end]) + "\n… \(units - used) more characters not shown"
  }

  private static func render(_ object: [String: Any]) -> String {
    func field(_ key: String) -> String? {
      guard let text = object[key] as? String, !text.isEmpty else { return nil }
      return text
    }
    func lines(_ parts: [String?]) -> String {
      parts.compactMap { $0 }.joined(separator: "\n")
    }
    switch object["kind"] as? String {
    case "command":
      return lines([field("command").map { "$ " + $0 }, field("cwd").map { "in " + $0 }])
    case "file_io":
      return lines([
        [field("operation"), field("path")].compactMap { $0 }.joined(separator: " "),
        field("detail"),
        field("content").map { "--- content\n" + $0 },
        field("before").map { "--- before\n" + $0 },
        field("after").map { "+++ after\n" + $0 },
      ])
    case "diff":
      return lines([
        field("path"),
        field("before").map { "--- before\n" + $0 },
        field("after").map { "+++ after\n" + $0 },
      ])
    case "search":
      return lines([field("query"), field("scope").map { "in " + $0 }])
    case "url_fetch":
      return [field("method"), field("url")].compactMap { $0 }.joined(separator: " ")
    case "agent_call":
      return lines([field("agent_name"), field("prompt")])
    case "skill_call":
      return lines([field("skill_name"), field("args")])
    case "plan_review":
      return lines([field("path"), field("plan")])
    case "goal_start":
      return lines([field("objective"), field("completionCriterion")])
    case "task":
      return lines([field("description"), field("status")])
    case "task_stop":
      return lines([field("task_description"), field("task_id")])
    case "generic":
      return lines([field("summary"), field("detail") ?? json(object["detail"])])
    default:
      return json(object) ?? ""
    }
  }

  private static func json(_ value: Any?) -> String? {
    guard let value, JSONSerialization.isValidJSONObject(value),
      let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
      let text = String(data: data, encoding: .utf8)
    else {
      return nil
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
