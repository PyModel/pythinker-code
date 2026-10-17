import Foundation
import Testing

@testable import PythinkerKit

@Test func deviceLinkDropsQueryAndKeepsDevicePath() throws {
    let base = try RemoteLink.parse(
        "https://relay.example/devices/abc123/?rc=1&from=pythinker_code_cli"
    )
    #expect(base.base.absoluteString == "https://relay.example/devices/abc123")
    #expect(base.relayHost == "relay.example")
    #expect(base.restRoot.absoluteString == "https://relay.example/devices/abc123/api/v1")
    #expect(try base.socketURL().absoluteString == "wss://relay.example/devices/abc123/api/v1/ws")
}

@Test func sessionLinkStopsAtDevice() throws {
    let base = try RemoteLink.parse(
        "https://relay.example/devices/abc123/sessions/session_1?rc=1"
    )
    #expect(base.base.absoluteString == "https://relay.example/devices/abc123")
}

@Test func nonZeroCodeIsFailure() {
    let outcome = EnvelopeRules.outcome(code: 40401, message: "missing", dismiss: false)
    #expect(outcome == .failure(code: 40401, message: "missing"))
}

@Test func questionDismissCodeIsSuccess() {
    let outcome = EnvelopeRules.outcome(code: 40909, message: "dismissed", dismiss: true)
    #expect(outcome == .success)
}

@Test func alreadyResolvedClosesWithoutRetry() {
    let outcome = EnvelopeRules.outcome(code: 40902, message: "done", dismiss: false)
    #expect(outcome == .alreadyResolved)
}

@Test func lowOffsetIsDuplicate() {
    var cursor = StreamCursor(textLength: 4)
    #expect(cursor.apply(offset: 2, chunk: "xx") == false)
    #expect(cursor.textLength == 4)
    #expect(cursor.apply(offset: 4, chunk: "hi") == true)
    #expect(cursor.textLength == 6)
}

@Test func unknownServerVersionIsRefused() {
    #expect(throws: VersionGateError.unknown("9.9.9")) {
        try VersionGate.accept("9.9.9", known: ["2.8.0"])
    }
}

@Test func pairScreenShowsHostBeforeSave() throws {
    var phone = PhoneState()
    try phone.stageLink("https://relay.example/devices/abc/?rc=1")
    #expect(phone.relayHost == "relay.example")
    #expect(phone.phase != .paired(try RemoteLink.parse("https://relay.example/devices/abc/")))
    phone.saveConfirmed()
    if case .paired = phone.phase {
    } else {
        Issue.record("save did not pair")
    }
}

@Test func sendStaysOffWhileUnpaired() {
    var phone = PhoneState()
    phone.draft = "hello"
    #expect(phone.canSend == false)
}

@Test func promptRequestHasNoBearerAndUsesSessionPath() throws {
    let request = try ControlAction.prompt(sessionID: "session_1", text: "hello").request()
    #expect(request.method == "POST")
    #expect(request.path == "/sessions/session_1/prompts")
    let body = String(decoding: request.body ?? Data(), as: UTF8.self)
    #expect(body.contains("hello"))
    #expect(!body.contains("Authorization"))
}

@Test func dismissRequestUsesDismissTail() throws {
    let request = try ControlAction.dismiss(sessionID: "session_1", questionID: "q1").request()
    #expect(request.path == "/sessions/session_1/questions/q1:dismiss")
}

@Test func sessionFactsPreferApprovalOverBusy() throws {
    let raw = #"{"id":"session_1","title":"Fix the build","busy":true,"pending_interaction":"approval"}"#
    let facts = try JSONDecoder().decode(SessionFacts.self, from: Data(raw.utf8))
    #expect(facts.activity == "approval")
    #expect(facts.row.title == "Fix the build")
}

@Test func idleFailedTurnIsFailed() throws {
    let raw = #"{"id":"session_2","title":"Notes","busy":false,"last_turn_reason":"failed"}"#
    let facts = try JSONDecoder().decode(SessionFacts.self, from: Data(raw.utf8))
    #expect(facts.activity == "failed")
}

@Test func subscribeFrameKeepsCursor() throws {
    let frame = try SocketFrames.subscribe(
        sessionIDs: ["session_1"],
        cursors: ["session_1": SubscribeCursor(seq: 4, epoch: "ep")]
    )
    #expect(frame.contains("\"type\":\"subscribe\""))
    #expect(frame.contains("\"seq\":4"))
    #expect(frame.contains("\"epoch\":\"ep\""))
}

@Test func approvalNeedsToolNameAndInput() {
    let hidden = ApprovalDraft(toolName: "", action: "bash", inputDisplay: "ls")
    let shown = ApprovalDraft(toolName: "Bash", action: "bash", inputDisplay: "ls")
    #expect(hidden.canApprove == false)
    #expect(shown.canApprove == true)
}

@Test func answerBodyUsesTheItemId() throws {
    let request = try ControlAction.answer(
        sessionID: "session_1",
        questionID: "question_9",
        itemID: "q_2",
        optionID: "opt_a"
    ).request()
    let object = try jsonObject(request.body)
    let answers = object["answers"] as? [String: Any]
    let item = answers?["q_2"] as? [String: Any]
    #expect(item?["kind"] as? String == "single")
    #expect(item?["option_id"] as? String == "opt_a")
    #expect(answers?["q_0"] == nil)
}

@Test func promptNewlineRoundTripsThroughJSON() throws {
    let text = "line\n\"quote\""
    let request = try ControlAction.prompt(sessionID: "session_1", text: text).request()
    let object = try jsonObject(request.body)
    let content = object["content"] as? [[String: Any]]
    #expect(content?.first?["text"] as? String == text)
}

@Test func slashDotDotIdIsRejectedAndBuildsNoRequest() throws {
    #expect(throws: ControlBuildError.rejectedID("../")) {
        _ = try ControlAction.prompt(sessionID: "../", text: "hi").request()
    }
}

@Test @MainActor func rejectedIdDoesNotCallTransport() async throws {
    let transport = ScriptedTransport()
    let desk = try pairedDesk(transport)
    desk.state.selectedSessionID = "../secret"
    desk.state.draft = "hi"
    desk.state.versionAccepted = true
    desk.state.socketUp = true
    await desk.sendPromptNow()
    #expect(transport.requests.isEmpty)
}

@Test @MainActor func unknownServerVersionDoesNotProduceAPrompt() async throws {
    let transport = ScriptedTransport()
    transport.handler = { request in
        if request.path == "/meta" {
            return ControlHTTPResult(status: 200, body: envelope(code: 0, message: "ok", data: [
                "server_version": "9.9.9",
            ]))
        }
        return ControlHTTPResult(status: 200, body: envelope(code: 0, message: "ok", data: [:]))
    }
    let desk = try pairedDesk(transport)
    desk.state.selectedSessionID = "session_1"
    desk.state.draft = "hello"
    desk.state.socketUp = true
    await desk.sendPromptNow()
    #expect(transport.requests.contains { $0.path.contains("prompts") } == false)
    #expect(transport.requests.contains { $0.path == "/meta" })
    if case .stopped(let message) = desk.state.phase {
        #expect(message.contains("9.9.9"))
    } else {
        Issue.record("unknown version did not stop the phone")
    }
}

@Test func dismissCodesUseTheDecodedResponsePath() {
    let dismissed = ResponsePath.decode(
        status: 200,
        body: envelope(code: 40909, message: "dismissed", data: ["dismissed": true]),
        dismiss: true
    )
    #expect(dismissed.outcome == .success)
    #expect(dismissed.retried == false)
    #expect(dismissed.closesSheet == false)

    let closed = ResponsePath.decode(
        status: 200,
        body: envelope(code: 40902, message: "done", data: ["resolved": false]),
        dismiss: false
    )
    #expect(closed.outcome == .alreadyResolved)
    #expect(closed.closesSheet == true)
    #expect(closed.retried == false)

    let httpFailed = ResponsePath.decode(status: 500, body: Data("nope".utf8), dismiss: false)
    #expect(httpFailed.outcome == .failure(code: 500, message: "HTTP 500"))
    #expect(httpFailed.retried == false)
}

@Test @MainActor func deskAppliesDismissAndAlreadyResolvedWithoutRetry() async throws {
    let transport = ScriptedTransport()
    let desk = try pairedDesk(transport)
    desk.state.versionAccepted = true
    desk.state.selectedSessionID = "session_1"
    desk.state.question = PendingQuestion(
        id: "question_9",
        items: [QuestionItem(id: "q_2", prompt: "Pick", options: [QuestionOption(id: "opt_a", label: "A")])]
    )
    transport.handler = { _ in
        ControlHTTPResult(status: 200, body: envelope(code: 40909, message: "dismissed", data: ["dismissed": true]))
    }
    await desk.dismissNow()
    #expect(desk.state.question == nil)
    #expect(desk.state.banner == nil)
    #expect(transport.requests.filter { $0.path.contains(":dismiss") }.count == 1)

    desk.state.question = PendingQuestion(
        id: "question_9",
        items: [QuestionItem(id: "q_2", prompt: "Pick", options: [QuestionOption(id: "opt_a", label: "A")])]
    )
    desk.state.selectedItemID = "q_2"
    desk.state.selectedOptionID = "opt_a"
    transport.handler = { _ in
        ControlHTTPResult(status: 200, body: envelope(code: 40902, message: "done", data: ["resolved": false]))
    }
    let before = transport.requests.count
    await desk.answerNow()
    #expect(desk.state.question == nil)
    #expect(transport.requests.count == before + 1)
}

@Test @MainActor func resyncReplacesTranscriptAndSubscribesAtSnapshotCursor() async throws {
    let transport = ScriptedTransport()
    let socket = RecordingSocket()
    let desk = PhoneDesk(transport: transport, store: MemoryLinkStore(), socket: socket)
    desk.state.phase = .paired(try RemoteLink.parse("https://relay.example/devices/abc/"))
    desk.state.selectedSessionID = "session_1"
    desk.state.versionAccepted = true
    desk.state.transcript = SessionTranscript(
        liveText: "OLD",
        cursor: StreamCursor(textLength: 3),
        tools: [ToolCard(id: "old", name: "Old", status: "running")]
    )
    transport.handler = { request in
        #expect(request.path == "/sessions/session_1/snapshot")
        return ControlHTTPResult(status: 200, body: snapshotBody())
    }
    let frame = try await desk.recover(sessionID: "session_1")
    #expect(frame.contains("\"seq\":12"))
    #expect(frame.contains("\"epoch\":\"ep-2\""))
    #expect(desk.state.transcript.assistantText == "from snapshot")
    #expect(!desk.state.transcript.assistantText.contains("OLD"))
    #expect(desk.state.transcript.tools.map(\.name) == ["Bash"])
    #expect(socket.sent == [frame])
}

@Test func lowOffsetDoesNotAppendTwice() {
    var transcript = SessionTranscript(
        liveText: "from snapshot",
        cursor: StreamCursor(textLength: 13)
    )
    #expect(transcript.applyDelta(offset: 2, chunk: "xx") == false)
    #expect(transcript.assistantText == "from snapshot")
    #expect(transcript.applyDelta(offset: 13, chunk: "!") == true)
    #expect(transcript.assistantText == "from snapshot!")
}

@Test func canSendIsFalseWhenTheSocketIsDown() throws {
    var phone = PhoneState()
    phone.phase = .paired(try RemoteLink.parse("https://relay.example/devices/abc/"))
    phone.draft = "hello"
    phone.versionAccepted = true
    phone.selectedSessionID = "session_1"
    phone.socketUp = false
    #expect(phone.canSend == false)
    phone.socketUp = true
    #expect(phone.canSend == true)
}

@Test func approvePathUsesDraftIdAndOmitsScopeUntilSecondConfirm() throws {
    var phone = PhoneState()
    phone.selectedSessionID = "session_1"
    phone.approval = ApprovalDraft(
        toolName: "Bash",
        action: "bash",
        inputDisplay: "ls",
        id: "apr_draft_7"
    )
    let first = try phone.approvalRequest(decision: "approved")
    #expect(first.path.contains("/approvals/apr_draft_7"))
    #expect(try jsonObject(first.body)["scope"] == nil)
    phone.confirmSessionScope()
    let second = try phone.approvalRequest(decision: "approved")
    #expect(try jsonObject(second.body)["scope"] as? String == "session")
}

@Test @MainActor func memoryStoreSaveThenForgetRemovesTheURL() throws {
    let store = MemoryLinkStore()
    let desk = PhoneDesk(transport: ScriptedTransport(), store: store)
    desk.paste = "https://relay.example/devices/abc/?rc=1"
    desk.stagePasted()
    desk.saveConfirmed()
    #expect(desk.paste == "")
    #expect(try store.load()?.absoluteString == "https://relay.example/devices/abc")
    desk.forget()
    #expect(try store.load() == nil)
    #expect(desk.paste == "")
    #expect(desk.state.phase == .unpaired)
}

@Test @MainActor func staleCompletionDoesNotChangePhaseAfterForget() throws {
    let desk = PhoneDesk(transport: ScriptedTransport(), store: MemoryLinkStore())
    let base = try RemoteLink.parse("https://relay.example/devices/abc/")
    desk.state.phase = .paired(base)
    let seen = desk.state.generation
    desk.applyTransportFailure(generation: seen)
    #expect(desk.state.phase == .offline(base))
    desk.state.phase = .paired(base)
    let stale = desk.state.generation
    desk.forget()
    desk.applyTransportFailure(generation: stale)
    #expect(desk.state.phase == .unpaired)
}

@Test @MainActor func unselectedSessionDoesNotSendTheFirstRow() async throws {
    let transport = ScriptedTransport()
    let desk = try pairedDesk(transport)
    desk.state.versionAccepted = true
    desk.state.socketUp = true
    desk.state.draft = "hello"
    desk.state.sessions = [SessionRow(id: "session_9", title: "Notes", activity: "idle")]
    await desk.sendPromptNow()
    await desk.stopNow()
    await desk.decideNow(.approved)
    await desk.answerNow()
    await desk.dismissNow()
    #expect(transport.requests.isEmpty)
}

@Test func liveRequestOmitsAuthorizationAndKeepsAbortColon() throws {
    let base = try RemoteLink.parse("https://relay.example/devices/abc123/")
    let prompt = try ControlAction.prompt(sessionID: "session_1", text: "hi").request()
    let http = try LiveControlTransport.makeURLRequest(prompt, to: base)
    #expect(http.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(http.value(forHTTPHeaderField: "Sec-WebSocket-Protocol") == nil)
    #expect(http.url?.absoluteString == "https://relay.example/devices/abc123/api/v1/sessions/session_1/prompts")
    let abort = try ControlAction.abort(sessionID: "session_1").request()
    let abortURL = try LiveControlTransport.makeURLRequest(abort, to: base)
    #expect(abortURL.url?.absoluteString.hasSuffix("/sessions/session_1:abort") == true)
}

@Test func acceptedVersionMatchesGatewayPackage() throws {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let data = try Data(contentsOf: root.appending(path: "packages/agent-gateway/package.json"))
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    #expect(VersionGate.acceptedServerVersion == object?["version"] as? String)
}

@MainActor
private func pairedDesk(_ transport: ScriptedTransport) throws -> PhoneDesk {
    let desk = PhoneDesk(transport: transport, store: MemoryLinkStore())
    desk.state.phase = .paired(try RemoteLink.parse("https://relay.example/devices/abc/"))
    return desk
}

private func jsonObject(_ body: Data?) throws -> [String: Any] {
    let data = try #require(body)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func envelope(code: Int, message: String, data: [String: Any]) -> Data {
    let object: [String: Any] = [
        "code": code,
        "msg": message,
        "data": data,
        "request_id": "r",
    ]
    return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}

private func snapshotBody() -> Data {
    let object: [String: Any] = [
        "code": 0,
        "msg": "ok",
        "request_id": "r",
        "data": [
            "as_of_seq": 12,
            "epoch": "ep-2",
            "messages": ["items": []],
            "in_flight_turn": [
                "assistant_text": "from snapshot",
                "running_tools": [
                    ["tool_call_id": "call_1", "name": "Bash"],
                ],
            ],
        ],
    ]
    return try! JSONSerialization.data(withJSONObject: object)
}

private final class ScriptedTransport: GatewayTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [ControlRequest] = []
    var handler: @Sendable (ControlRequest) -> ControlHTTPResult = { _ in
        ControlHTTPResult(status: 200, body: Data(#"{"code":0,"msg":"ok","data":{},"request_id":"r"}"#.utf8))
    }

    var requests: [ControlRequest] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func perform(_ request: ControlRequest, to base: RemoteBase) async throws -> ControlHTTPResult {
        let handler = record(request)
        return handler(request)
    }

    private func record(_ request: ControlRequest) -> @Sendable (ControlRequest) -> ControlHTTPResult {
        lock.lock()
        stored.append(request)
        let handler = self.handler
        lock.unlock()
        return handler
    }
}

private final class RecordingSocket: EventSocket, @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [String] = []

    var sent: [String] {
        lock.lock()
        defer { lock.unlock() }
        return frames
    }

    func open(_ url: URL) async throws {}

    func send(_ text: String) async throws {
        remember(text)
    }

    private func remember(_ text: String) {
        lock.lock()
        frames.append(text)
        lock.unlock()
    }

    func next() async throws -> String {
        throw CancellationError()
    }

    func close() {}
}
