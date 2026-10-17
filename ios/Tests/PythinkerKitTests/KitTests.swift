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
    #expect(base.socketURL.absoluteString == "wss://relay.example/devices/abc123/api/v1/ws")
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

@Test func promptRequestHasNoBearerAndUsesSessionPath() {
    let request = ControlAction.prompt(sessionID: "session_1", text: "hello").request()
    #expect(request.method == "POST")
    #expect(request.path == "/sessions/session_1/prompts")
    let body = String(decoding: request.body ?? Data(), as: UTF8.self)
    #expect(body.contains("hello"))
    #expect(!body.contains("Authorization"))
}

@Test func dismissRequestUsesDismissTail() {
    let request = ControlAction.dismiss(sessionID: "session_1", questionID: "q1").request()
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

@Test func subscribeFrameKeepsCursor() {
    let frame = SocketFrames.subscribe(
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
