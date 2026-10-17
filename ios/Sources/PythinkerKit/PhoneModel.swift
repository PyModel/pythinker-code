import Foundation

public struct SessionRow: Equatable, Sendable, Identifiable {
  public let id: String
  public var title: String
  public var activity: String

  public init(id: String, title: String, activity: String) {
    self.id = id
    self.title = title
    self.activity = activity
  }
}

public struct ApprovalDraft: Equatable, Sendable, Identifiable {
  public var id: String
  public let toolName: String
  public let action: String
  public let inputDisplay: String

  public init(toolName: String, action: String, inputDisplay: String, id: String = "") {
    self.id = id
    self.toolName = toolName
    self.action = action
    self.inputDisplay = inputDisplay
  }

  public var canApprove: Bool {
    !toolName.isEmpty && !inputDisplay.isEmpty
  }

  public var canDecide: Bool {
    !id.isEmpty && !toolName.isEmpty && !action.isEmpty && !inputDisplay.isEmpty
  }
}

public struct QuestionOption: Equatable, Sendable, Identifiable {
  public let id: String
  public let label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

public struct QuestionItem: Equatable, Sendable, Identifiable {
  public let id: String
  public let prompt: String
  public let options: [QuestionOption]
  public let multiSelect: Bool
  public let allowOther: Bool
  public let otherLabel: String

  public init(
    id: String,
    prompt: String,
    options: [QuestionOption],
    multiSelect: Bool = false,
    allowOther: Bool = false,
    otherLabel: String = "Other"
  ) {
    self.id = id
    self.prompt = prompt
    self.options = options
    self.multiSelect = multiSelect
    self.allowOther = allowOther
    self.otherLabel = otherLabel
  }
}

public struct PendingQuestion: Equatable, Sendable, Identifiable {
  public var id: String
  public var items: [QuestionItem]

  public init(id: String, items: [QuestionItem]) {
    self.id = id
    self.items = items
  }
}

public struct PendingPrompt: Equatable, Sendable {
  public let id: String
  public let text: String

  public init(id: String, text: String) {
    self.id = id
    self.text = text
  }
}

public enum PhonePhase: Equatable, Sendable {
  case unpaired
  case confirm(RemoteBase)
  case paired(RemoteBase)
  case offline(RemoteBase)
  case stopped(RemoteBase, String)
}

public struct PhoneState: Equatable, Sendable {
  public var phase: PhonePhase
  public var sessions: [SessionRow]
  public var selectedSessionID: String?
  public var draft: String
  public var approvals: [ApprovalDraft]
  public var questions: [PendingQuestion]
  public var choices: [String: [String]]
  public var otherText: [String: String]
  public var transcript: SessionTranscript
  public var versionAccepted: Bool
  public var socketUp: Bool
  public var scopeApprovalID: String?
  public var pendingPrompt: PendingPrompt?
  public var refusal: String?
  public var banner: String?
  public var isLoading: Bool
  public var sendInFlight: Bool
  public var generation: Int

  public init(
    phase: PhonePhase = .unpaired,
    sessions: [SessionRow] = [],
    selectedSessionID: String? = nil,
    draft: String = "",
    approvals: [ApprovalDraft] = [],
    questions: [PendingQuestion] = [],
    transcript: SessionTranscript = SessionTranscript(),
    versionAccepted: Bool = false,
    socketUp: Bool = false,
    refusal: String? = nil,
    banner: String? = nil,
    isLoading: Bool = false,
    sendInFlight: Bool = false,
    generation: Int = 0
  ) {
    self.phase = phase
    self.sessions = sessions
    self.selectedSessionID = selectedSessionID
    self.draft = draft
    self.approvals = approvals
    self.questions = questions
    self.choices = [:]
    self.otherText = [:]
    self.transcript = transcript
    self.versionAccepted = versionAccepted
    self.socketUp = socketUp
    self.scopeApprovalID = nil
    self.pendingPrompt = nil
    self.refusal = refusal
    self.banner = banner
    self.isLoading = isLoading
    self.sendInFlight = sendInFlight
    self.generation = generation
  }

  public var approval: ApprovalDraft? { approvals.first }

  public var question: PendingQuestion? { questions.first }

  public var scopeConfirmed: Bool {
    guard let scopeApprovalID else { return false }
    return scopeApprovalID == approval?.id
  }

  public mutating func stageLink(_ raw: String) throws {
    phase = .confirm(try RemoteLink.parse(raw))
  }

  public mutating func saveConfirmed() {
    if case .confirm(let base) = phase {
      phase = .paired(base)
    }
  }

  public mutating func forget() {
    generation += 1
    phase = .unpaired
    sessions = []
    selectedSessionID = nil
    draft = ""
    clearInteractions()
    transcript = SessionTranscript()
    versionAccepted = false
    socketUp = false
    pendingPrompt = nil
    refusal = nil
    banner = nil
    isLoading = false
    sendInFlight = false
  }

  public mutating func clearInteractions() {
    approvals = []
    questions = []
    choices = [:]
    otherText = [:]
    scopeApprovalID = nil
  }

  public mutating func replaceInteractions(
    approvals: [ApprovalDraft], questions: [PendingQuestion]
  ) {
    let head = question?.id
    self.approvals = approvals
    self.questions = questions
    if question?.id != head {
      choices = [:]
      otherText = [:]
    }
    if !scopeConfirmed {
      scopeApprovalID = nil
    }
  }

  public mutating func upsertApproval(_ draft: ApprovalDraft) {
    if let index = approvals.firstIndex(where: { $0.id == draft.id }) {
      approvals[index] = draft
    } else {
      approvals.append(draft)
    }
  }

  public mutating func dropApproval(id: String) {
    approvals.removeAll { $0.id == id }
    if scopeApprovalID == id {
      scopeApprovalID = nil
    }
  }

  public mutating func upsertQuestion(_ pending: PendingQuestion) {
    if let index = questions.firstIndex(where: { $0.id == pending.id }) {
      questions[index] = pending
    } else {
      questions.append(pending)
    }
  }

  public mutating func dropQuestion(id: String) {
    let wasHead = question?.id == id
    questions.removeAll { $0.id == id }
    if wasHead {
      choices = [:]
      otherText = [:]
    }
  }

  public mutating func choose(itemID: String, optionID: String) {
    guard let item = question?.items.first(where: { $0.id == itemID }),
      item.options.contains(where: { $0.id == optionID })
    else { return }
    if item.multiSelect {
      var picked = choices[itemID] ?? []
      if let index = picked.firstIndex(of: optionID) {
        picked.remove(at: index)
      } else {
        picked.append(optionID)
      }
      choices[itemID] = picked
    } else {
      choices[itemID] = [optionID]
      otherText[itemID] = nil
    }
  }

  public mutating func setOther(itemID: String, text: String) {
    guard let item = question?.items.first(where: { $0.id == itemID }), item.allowOther else {
      return
    }
    otherText[itemID] = text
    if !item.multiSelect && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      choices[itemID] = nil
    }
  }

  public func isChosen(itemID: String, optionID: String) -> Bool {
    choices[itemID]?.contains(optionID) ?? false
  }

  public func answer(for item: QuestionItem) -> QuestionAnswer? {
    let valid = Set(item.options.map(\.id))
    let picked = (choices[item.id] ?? []).filter { valid.contains($0) }
    let typed = item.allowOther ? otherText[item.id] ?? "" : ""
    let other = typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : typed
    if item.multiSelect {
      if let other, !picked.isEmpty { return .multiWithOther(optionIDs: picked, text: other) }
      if !picked.isEmpty { return .multi(optionIDs: picked) }
      if let other { return .other(text: other) }
      return nil
    }
    if let first = picked.first { return .single(optionID: first) }
    if let other { return .other(text: other) }
    return nil
  }

  public var relayHost: String? {
    switch phase {
    case .confirm(let base), .paired(let base), .offline(let base), .stopped(let base, _):
      return base.relayHost
    case .unpaired:
      return nil
    }
  }

  public var activeBase: RemoteBase? {
    switch phase {
    case .paired(let base), .offline(let base):
      return base
    case .confirm, .unpaired, .stopped:
      return nil
    }
  }

  public var canControl: Bool {
    guard case .paired = phase else { return false }
    return selectedSessionID != nil && !isLoading
  }

  public var canSend: Bool {
    guard canControl, socketUp, !sendInFlight else { return false }
    return !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public var canStop: Bool { canControl }

  public var canApprove: Bool {
    canControl && (approval?.canDecide ?? false)
  }

  public var canReject: Bool {
    canControl && approval?.id.isEmpty == false
  }

  public var canDismiss: Bool {
    canControl && question?.id.isEmpty == false
  }

  public var canAnswer: Bool {
    guard canControl, let question, !question.items.isEmpty else { return false }
    return question.items.allSatisfy { answer(for: $0) != nil }
  }

  public func promptRequest() throws -> ControlRequest {
    guard let sessionID = selectedSessionID, let pendingPrompt else {
      throw ControlBuildError.rejectedID("")
    }
    return try ControlAction.prompt(
      sessionID: sessionID, text: pendingPrompt.text, promptID: pendingPrompt.id
    ).request()
  }

  public func abortRequest() throws -> ControlRequest {
    guard let sessionID = selectedSessionID else {
      throw ControlBuildError.rejectedID("")
    }
    return try ControlAction.abort(sessionID: sessionID).request()
  }

  public func approvalRequest(decision: String, approvalID: String) throws -> ControlRequest {
    guard let sessionID = selectedSessionID else {
      throw ControlBuildError.rejectedID("")
    }
    guard approvals.contains(where: { $0.id == approvalID }) else {
      throw ControlBuildError.stale(approvalID)
    }
    let scope =
      scopeApprovalID == approvalID && decision == ApprovalDecision.approved.rawValue
      ? "session" : nil
    return try ControlAction.approve(
      sessionID: sessionID,
      approvalID: approvalID,
      decision: decision,
      scope: scope
    ).request()
  }

  public func answerRequest(questionID: String) throws -> ControlRequest {
    guard let sessionID = selectedSessionID else {
      throw ControlBuildError.rejectedID("")
    }
    guard let question, question.id == questionID else {
      throw ControlBuildError.stale(questionID)
    }
    var answers: [String: QuestionAnswer] = [:]
    for item in question.items {
      answers[item.id] = answer(for: item)
    }
    guard !question.items.isEmpty, answers.count == question.items.count else {
      throw ControlBuildError.rejectedID(question.id)
    }
    return try ControlAction.answer(
      sessionID: sessionID,
      questionID: question.id,
      answers: answers
    ).request()
  }

  public func dismissRequest(questionID: String) throws -> ControlRequest {
    guard let sessionID = selectedSessionID else {
      throw ControlBuildError.rejectedID("")
    }
    guard questions.contains(where: { $0.id == questionID }) else {
      throw ControlBuildError.stale(questionID)
    }
    return try ControlAction.dismiss(sessionID: sessionID, questionID: questionID).request()
  }

  public mutating func confirmSessionScope() {
    scopeApprovalID = approval?.id
  }
}
