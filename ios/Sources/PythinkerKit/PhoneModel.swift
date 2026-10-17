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

    public init(id: String, prompt: String, options: [QuestionOption]) {
        self.id = id
        self.prompt = prompt
        self.options = options
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

public enum PhonePhase: Equatable, Sendable {
    case unpaired
    case confirm(RemoteBase)
    case paired(RemoteBase)
    case offline(RemoteBase)
    case stopped(String)
}

public struct PhoneState: Equatable, Sendable {
    public var phase: PhonePhase
    public var sessions: [SessionRow]
    public var selectedSessionID: String?
    public var draft: String
    public var approval: ApprovalDraft?
    public var question: PendingQuestion?
    public var selectedItemID: String?
    public var selectedOptionID: String?
    public var transcript: SessionTranscript
    public var versionAccepted: Bool
    public var socketUp: Bool
    public var scopeConfirmed: Bool
    public var refusal: String?
    public var banner: String?
    public var generation: Int

    public init(
        phase: PhonePhase = .unpaired,
        sessions: [SessionRow] = [],
        selectedSessionID: String? = nil,
        draft: String = "",
        approval: ApprovalDraft? = nil,
        question: PendingQuestion? = nil,
        selectedItemID: String? = nil,
        selectedOptionID: String? = nil,
        transcript: SessionTranscript = SessionTranscript(),
        versionAccepted: Bool = false,
        socketUp: Bool = false,
        scopeConfirmed: Bool = false,
        refusal: String? = nil,
        banner: String? = nil,
        generation: Int = 0
    ) {
        self.phase = phase
        self.sessions = sessions
        self.selectedSessionID = selectedSessionID
        self.draft = draft
        self.approval = approval
        self.question = question
        self.selectedItemID = selectedItemID
        self.selectedOptionID = selectedOptionID
        self.transcript = transcript
        self.versionAccepted = versionAccepted
        self.socketUp = socketUp
        self.scopeConfirmed = scopeConfirmed
        self.refusal = refusal
        self.banner = banner
        self.generation = generation
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
        approval = nil
        question = nil
        selectedItemID = nil
        selectedOptionID = nil
        transcript = SessionTranscript()
        versionAccepted = false
        socketUp = false
        scopeConfirmed = false
        refusal = nil
        banner = nil
    }

    public var relayHost: String? {
        switch phase {
        case .confirm(let base), .paired(let base), .offline(let base):
            return base.relayHost
        case .unpaired, .stopped:
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

    public var canSend: Bool {
        guard case .paired = phase else { return false }
        guard versionAccepted, socketUp, selectedSessionID != nil else { return false }
        return !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var canAnswer: Bool {
        guard selectedSessionID != nil, let question, let itemID = selectedItemID, let optionID = selectedOptionID else {
            return false
        }
        guard question.items.contains(where: { $0.id == itemID }) else { return false }
        return question.items.contains { item in
            item.id == itemID && item.options.contains { $0.id == optionID }
        }
    }

    public func promptRequest() throws -> ControlRequest {
        guard let sessionID = selectedSessionID else {
            throw ControlBuildError.rejectedID("")
        }
        return try ControlAction.prompt(sessionID: sessionID, text: draft).request()
    }

    public func abortRequest() throws -> ControlRequest {
        guard let sessionID = selectedSessionID else {
            throw ControlBuildError.rejectedID("")
        }
        return try ControlAction.abort(sessionID: sessionID).request()
    }

    public func approvalRequest(decision: String) throws -> ControlRequest {
        guard let sessionID = selectedSessionID, let approval else {
            throw ControlBuildError.rejectedID("")
        }
        let scope = scopeConfirmed && decision == ApprovalDecision.approved.rawValue ? "session" : nil
        return try ControlAction.approve(
            sessionID: sessionID,
            approvalID: approval.id,
            decision: decision,
            scope: scope
        ).request()
    }

    public func answerRequest() throws -> ControlRequest {
        guard let sessionID = selectedSessionID,
            let question,
            let itemID = selectedItemID,
            let optionID = selectedOptionID
        else {
            throw ControlBuildError.rejectedID("")
        }
        return try ControlAction.answer(
            sessionID: sessionID,
            questionID: question.id,
            itemID: itemID,
            optionID: optionID
        ).request()
    }

    public func dismissRequest() throws -> ControlRequest {
        guard let sessionID = selectedSessionID, let question else {
            throw ControlBuildError.rejectedID("")
        }
        return try ControlAction.dismiss(sessionID: sessionID, questionID: question.id).request()
    }

    public mutating func confirmSessionScope() {
        scopeConfirmed = true
    }
}
