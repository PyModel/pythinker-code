import SwiftUI
import PythinkerKit

@main
struct PythinkerApp: App {
    @State private var phone = PhoneState()

    var body: some Scene {
        WindowGroup {
            PhoneRoot(phone: $phone)
        }
    }
}

struct PhoneRoot: View {
    @Binding var phone: PhoneState
    @State private var pasted = ""
    @State private var optionID = ""

    var body: some View {
        NavigationStack {
            switch phone.phase {
            case .unpaired:
                pairForm
            case .confirm:
                confirmForm
            case .paired, .offline:
                sessionForm
            }
        }
    }

    private var pairForm: some View {
        Form {
            TextField("Remote Control link", text: $pasted)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Continue") {
                try? phone.stageLink(pasted)
            }
            .disabled(pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .navigationTitle("Pair")
    }

    private var confirmForm: some View {
        Form {
            Text("This link controls the Mac.")
            if let host = phone.relayHost {
                Text("Relay host: \(host)")
            }
            Button("Save") { phone.saveConfirmed() }
            Button("Back", role: .cancel) { phone.forget() }
        }
        .navigationTitle("Confirm")
    }

    private var sessionForm: some View {
        Form {
            if case .offline = phone.phase {
                Text("Offline")
            }
            ForEach(phone.sessions) { row in
                Text("\(row.title) · \(row.activity)")
            }
            TextField("Prompt", text: $phone.draft)
            Button("Send") {
                send(.prompt(sessionID: phone.sessions.first?.id ?? "session", text: phone.draft))
            }
            .disabled(!phone.canSend)
            Button("Stop") {
                send(.abort(sessionID: phone.sessions.first?.id ?? "session"))
            }
            .disabled(phone.phase == .offline)
            if let approval = phone.approval {
                Text(approval.toolName)
                Text(approval.inputDisplay)
                Button("Approve") {
                    send(
                        .approve(
                            sessionID: phone.sessions.first?.id ?? "session",
                            approvalID: "approval",
                            decision: "approved"
                        )
                    )
                }
                .disabled(!approval.canApprove)
            }
            TextField("Question option", text: $optionID)
            Button("Answer") {
                send(
                    .answer(
                        sessionID: phone.sessions.first?.id ?? "session",
                        questionID: "question",
                        optionID: optionID
                    )
                )
            }
            .disabled(optionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Dismiss question") {
                send(.dismiss(sessionID: phone.sessions.first?.id ?? "session", questionID: "question"))
            }
            Button("Forget link", role: .destructive) { phone.forget() }
        }
        .navigationTitle("Sessions")
    }

    private func send(_ action: ControlAction) {
        guard case .paired(let base) = phone.phase else { return }
        Task {
            do {
                _ = try await ControlTransport.send(action.request(), to: base)
            } catch {
                phone.phase = .offline
            }
        }
    }
}
