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

public struct ApprovalDraft: Equatable, Sendable {
    public let toolName: String
    public let action: String
    public let inputDisplay: String

    public init(toolName: String, action: String, inputDisplay: String) {
        self.toolName = toolName
        self.action = action
        self.inputDisplay = inputDisplay
    }

    public var canApprove: Bool {
        !toolName.isEmpty && !inputDisplay.isEmpty
    }
}

public enum PhonePhase: Equatable, Sendable {
    case unpaired
    case confirm(RemoteBase)
    case paired(RemoteBase)
    case offline
}

public struct PhoneState: Equatable, Sendable {
    public var phase: PhonePhase
    public var sessions: [SessionRow]
    public var draft: String
    public var approval: ApprovalDraft?

    public init(
        phase: PhonePhase = .unpaired,
        sessions: [SessionRow] = [],
        draft: String = "",
        approval: ApprovalDraft? = nil
    ) {
        self.phase = phase
        self.sessions = sessions
        self.draft = draft
        self.approval = approval
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
        phase = .unpaired
        sessions = []
        approval = nil
    }

    public var relayHost: String? {
        switch phase {
        case .confirm(let base), .paired(let base):
            return base.relayHost
        case .unpaired, .offline:
            return nil
        }
    }

    public var canSend: Bool {
        if case .paired = phase, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }
        return false
    }
}
