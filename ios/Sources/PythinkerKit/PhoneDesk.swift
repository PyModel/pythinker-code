import Foundation
import Observation

@MainActor
@Observable
public final class PhoneDesk {
  public var state: PhoneState
  public var paste: String
  public private(set) var listenID: Int
  public var receiveDeadline: Duration = .seconds(20)
  public var recoveryDelay: Duration = .seconds(1)
  public static let maxRecoveries = 3

  private let transport: any GatewayTransport
  private let store: any LinkStore
  private let socket: any EventSocket
  private let makeID: @Sendable () -> String
  private var refreshTask: Task<Void, Never>?
  private var actionTask: Task<Void, Never>?
  private var actionID: Int
  private var subscribeID: Int

  public init(
    transport: any GatewayTransport,
    store: any LinkStore,
    socket: any EventSocket = NullEventSocket(),
    state: PhoneState = PhoneState(),
    makeID: @escaping @Sendable () -> String = { UUID().uuidString }
  ) {
    self.transport = transport
    self.store = store
    self.socket = socket
    self.state = state
    self.makeID = makeID
    self.paste = ""
    self.listenID = 0
    self.actionID = 0
    self.subscribeID = 0
  }

  public func stagePasted() {
    stage(paste, failure: "That link is not a Remote Control device link.")
  }

  public func stageScanned(_ raw: String) {
    stage(raw, failure: "That code is not a Remote Control link.")
  }

  public func saveConfirmed() {
    guard case .confirm(let base) = state.phase else { return }
    do {
      try store.save(baseURL: base.base)
    } catch {
      var next = state
      next.banner = "Could not save the link."
      state = next
      return
    }
    paste = ""
    var next = state
    next.saveConfirmed()
    state = next
    refreshSessions()
  }

  public func forget() {
    refreshTask?.cancel()
    refreshTask = nil
    actionTask?.cancel()
    actionTask = nil
    socket.close()
    var next = state
    next.forget()
    do {
      try store.forget()
    } catch {
      next.banner = "Could not remove the saved link from this phone. It may come back."
    }
    state = next
    paste = ""
    listenID += 1
  }

  public func restore() async {
    let url: URL?
    do {
      url = try store.load()
    } catch {
      var next = state
      next.banner = "Could not read the saved link. Pair again."
      state = next
      return
    }
    guard let url else { return }
    guard let base = try? RemoteLink.parse(url.absoluteString) else {
      var next = state
      next.banner = "The saved link was not valid. Pair again."
      do {
        try store.forget()
      } catch {
        next.banner = "The saved link was not valid and could not be removed. Pair again."
      }
      state = next
      return
    }
    paste = ""
    var next = state
    next.phase = .paired(base)
    next.banner = nil
    state = next
    await refreshSessions(state.generation)
  }

  public func retryAfterStop() {
    guard case .stopped(let base, _) = state.phase else { return }
    var next = state
    next.phase = .paired(base)
    next.refusal = nil
    next.banner = nil
    next.versionAccepted = false
    state = next
    refreshSessions()
  }

  public func refreshSessions() {
    let seen = state.generation
    refreshTask?.cancel()
    refreshTask = Task { await self.refreshSessions(seen) }
  }

  public func selectWorkspace(_ id: String?) {
    guard state.selectedWorkspaceID != id else { return }
    var next = state
    next.selectedWorkspaceID = id
    next.sessions = []
    state = next
    refreshSessions()
  }

  public func createSession() async -> String? {
    let life = state.generation
    guard await acceptVersion(life), life == state.generation else { return nil }
    guard let base = state.activeBase else {
      showBanner("The phone is not paired with a Mac.")
      return nil
    }
    guard let workspaceID = state.selectedWorkspaceID else {
      showBanner("Choose a workspace first.")
      return nil
    }
    do {
      let response = try await transport.perform(
        try ControlAction.createSession(workspaceID: workspaceID).request(), to: base)
      guard life == state.generation else { return nil }
      let decoded = ResponsePath.decode(
        status: response.status, body: response.body, dismiss: false)
      guard case .success = decoded.outcome,
        let created = try? JSONDecoder().decode(
          APIEnvelope<CreatedSession>.self, from: response.body
        ).data
      else {
        if case .failure(_, let message) = decoded.outcome, !message.isEmpty {
          showBanner(message)
        } else {
          showBanner("The Mac could not start a session.")
        }
        return nil
      }
      var next = state
      next.banner = nil
      if !next.sessions.contains(where: { $0.id == created.id }) {
        next.sessions.insert(
          SessionRow(id: created.id, title: "", activity: "idle", workspaceID: workspaceID),
          at: 0)
      }
      state = next
      refreshSessions()
      return created.id
    } catch {
      if Task.isCancelled || life != state.generation { return nil }
      applyTransportFailure(generation: life)
      return nil
    }
  }

  public func clearBanner() {
    guard state.banner != nil else { return }
    var next = state
    next.banner = nil
    state = next
  }

  public func select(_ id: String) {
    guard (try? ResourceID.segment(id)) != nil else { return }
    if state.selectedSessionID == id { return }
    var next = state
    next.selectedSessionID = id
    next.clearInteractions()
    next.pendingPrompt = nil
    next.transcript = SessionTranscript()
    next.socketUp = false
    next.banner = nil
    state = next
    listenID += 1
  }

  public func chooseOption(itemID: String, optionID: String) {
    var next = state
    next.choose(itemID: itemID, optionID: optionID)
    state = next
  }

  public func setOtherText(itemID: String, text: String) {
    var next = state
    next.setOther(itemID: itemID, text: text)
    state = next
  }

  public func confirmSessionScope() {
    var next = state
    next.confirmSessionScope()
    state = next
  }

  public func sendPrompt() {
    let seen = begin()
    track(Task { await self.performPrompt(seen) })
  }

  public func stop() {
    let seen = begin()
    track(Task { await self.performStop(seen) })
  }

  public func decide(_ decision: ApprovalDecision) {
    let id = state.approval?.id ?? ""
    let seen = begin()
    track(Task { await self.performDecision(decision, id: id, seen: seen) })
  }

  public func answer() {
    let id = state.question?.id ?? ""
    let seen = begin()
    track(Task { await self.performAnswer(id, seen: seen) })
  }

  public func dismiss() {
    let id = state.question?.id ?? ""
    let seen = begin()
    track(Task { await self.performDismiss(id, seen: seen) })
  }

  public func sendPromptNow() async {
    await performPrompt(begin())
  }

  public func stopNow() async {
    await performStop(begin())
  }

  public func decideNow(_ decision: ApprovalDecision) async {
    let id = state.approval?.id ?? ""
    await performDecision(decision, id: id, seen: begin())
  }

  public func answerNow() async {
    let id = state.question?.id ?? ""
    await performAnswer(id, seen: begin())
  }

  public func dismissNow() async {
    let id = state.question?.id ?? ""
    await performDismiss(id, seen: begin())
  }

  public func followSelected() async {
    guard let id = state.selectedSessionID, state.activeBase != nil else { return }
    let seen = state.generation
    let listen = listenID
    do {
      _ = try await recover(sessionID: id)
      try await readLoop(id, seen: seen, listen: listen)
    } catch is CancellationError {
      return
    } catch {
      if Task.isCancelled || seen != state.generation || listen != listenID { return }
      applyTransportFailure(generation: seen)
    }
  }

  public func recover(sessionID: String) async throws -> String {
    let seen = state.generation
    let listen = listenID
    guard await acceptVersion(seen) else { throw CancellationError() }
    guard listen == listenID else { throw CancellationError() }
    let base = try requireBase()
    let id = try ResourceID.segment(sessionID)
    if state.socketUp {
      try await socket.send(SocketFrames.keepalive())
    }
    let response = try await transport.perform(
      ControlRequest(method: "GET", path: "/sessions/\(id)/snapshot", body: nil),
      to: base
    )
    guard seen == state.generation, listen == listenID else { throw CancellationError() }
    let decoded = ResponsePath.decode(status: response.status, body: response.body, dismiss: false)
    guard case .success = decoded.outcome else {
      throw ControlBuildError.badResponse
    }
    let view = try SnapshotDecoder.decode(response.body)
    subscribeID += 1
    let frame = try SocketFrames.subscribe(
      id: String(subscribeID),
      sessionIDs: [id],
      cursors: [id: SubscribeCursor(seq: view.asOfSeq, epoch: view.epoch)]
    )
    if !state.socketUp {
      try await socket.open(try base.socketURL())
    }
    guard seen == state.generation, listen == listenID else { throw CancellationError() }
    var next = state
    next.transcript = view.transcript
    next.replaceInteractions(approvals: view.approvals, questions: view.questions)
    state = next
    try await socket.send(frame)
    var connected = state
    connected.socketUp = true
    if case .offline(let linked) = connected.phase {
      connected.phase = .paired(linked)
    }
    state = connected
    return frame
  }

  public func applyTransportFailure(generation seen: Int) {
    guard seen == state.generation else { return }
    guard case .paired(let base) = state.phase else { return }
    var next = state
    next.phase = .offline(base)
    next.socketUp = false
    state = next
  }

  private func stage(_ raw: String, failure: String) {
    var next = state
    do {
      try next.stageLink(raw)
      next.banner = nil
    } catch {
      next.banner = failure
    }
    state = next
  }

  private func begin() -> Int {
    actionID += 1
    if state.sendInFlight {
      var next = state
      next.sendInFlight = false
      state = next
    }
    return actionID
  }

  private func track(_ task: Task<Void, Never>) {
    actionTask?.cancel()
    actionTask = task
  }

  private func refreshSessions(_ seen: Int) async {
    guard await acceptVersion(seen) else { return }
    guard seen == state.generation, let base = state.activeBase else { return }
    let recovering: Bool
    if case .offline = state.phase {
      recovering = true
    } else {
      recovering = false
    }
    var loading = state
    loading.isLoading = true
    state = loading
    defer {
      if seen == state.generation {
        var done = state
        done.isLoading = false
        state = done
      }
    }
    do {
      let listed = try await transport.perform(
        ControlRequest(method: "GET", path: "/workspaces", body: nil),
        to: base
      )
      guard seen == state.generation else { return }
      let workspaces = try WorkspaceListDecoder.rows(status: listed.status, body: listed.body)
      var workspaceID = state.selectedWorkspaceID
      if let id = workspaceID, !workspaces.contains(where: { $0.id == id }) {
        workspaceID = nil
      }
      let response = try await transport.perform(
        ControlRequest(
          method: "GET", path: try SessionQuery.path(workspaceID: workspaceID), body: nil),
        to: base
      )
      guard seen == state.generation else { return }
      let rows = try SessionListDecoder.rows(status: response.status, body: response.body)
      var next = state
      next.workspaces = workspaces
      next.selectedWorkspaceID = workspaceID
      next.sessions = rows
      var dropped = false
      if let selected = next.selectedSessionID, !rows.contains(where: { $0.id == selected }) {
        next.selectedSessionID = nil
        next.clearInteractions()
        next.transcript = SessionTranscript()
        next.socketUp = false
        dropped = true
      }
      if case .offline(let linked) = next.phase {
        next.phase = .paired(linked)
      }
      next.banner = nil
      state = next
      if recovering || dropped, seen == state.generation {
        listenID += 1
      }
    } catch {
      if Task.isCancelled || seen != state.generation { return }
      applyTransportFailure(generation: seen)
    }
  }

  private func performPrompt(_ seen: Int) async {
    let life = state.generation
    guard seen == actionID, life == state.generation else { return }
    var next = state
    if next.pendingPrompt?.text != next.draft {
      next.pendingPrompt = PendingPrompt(id: makeID(), text: next.draft)
    }
    next.sendInFlight = true
    state = next
    defer {
      if seen == actionID, life == state.generation {
        var done = state
        done.sendInFlight = false
        state = done
      }
    }
    await performPost(
      seen: seen,
      dismiss: false,
      deliveredCode: EnvelopeRules.promptIDInUse,
      request: { try self.state.promptRequest() },
      onSuccess: { next in
        if next.draft == next.pendingPrompt?.text {
          next.draft = ""
        }
        next.pendingPrompt = nil
      }
    )
  }

  private func performStop(_ seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: false,
      request: { try self.state.abortRequest() },
      onSuccess: { _ in }
    )
  }

  private func performDecision(_ decision: ApprovalDecision, id: String, seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: false,
      request: {
        try self.state.approvalRequest(decision: decision.rawValue, approvalID: id)
      },
      onSuccess: { next in
        next.dropApproval(id: id)
      }
    )
  }

  private func performAnswer(_ id: String, seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: false,
      request: { try self.state.answerRequest(questionID: id) },
      onSuccess: { next in
        next.dropQuestion(id: id)
      }
    )
  }

  private func performDismiss(_ id: String, seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: true,
      request: { try self.state.dismissRequest(questionID: id) },
      onSuccess: { next in
        next.dropQuestion(id: id)
      }
    )
  }

  private func performPost(
    seen: Int,
    dismiss: Bool,
    deliveredCode: Int? = nil,
    request: () throws -> ControlRequest,
    onSuccess: (inout PhoneState) -> Void
  ) async {
    let life = state.generation
    guard seen == actionID, life == state.generation else { return }
    guard await acceptVersion(life) else { return }
    guard seen == actionID, life == state.generation else { return }
    guard let base = state.activeBase else {
      showBanner("The phone is not paired with a Mac.")
      return
    }
    let built: ControlRequest
    do {
      built = try request()
    } catch ControlBuildError.stale {
      showBanner("That item changed before it was sent. Check it and try again.")
      return
    } catch {
      showBanner("The phone could not build that request. Refresh and try again.")
      return
    }
    do {
      let response = try await transport.perform(built, to: base)
      guard seen == actionID, life == state.generation, !Task.isCancelled else { return }
      apply(
        response, dismiss: dismiss, deliveredCode: deliveredCode, action: seen, life: life,
        onSuccess: onSuccess)
    } catch {
      if Task.isCancelled || seen != actionID || life != state.generation { return }
      applyTransportFailure(generation: life)
    }
  }

  private func showBanner(_ message: String) {
    var next = state
    next.banner = message
    state = next
  }

  private func acceptVersion(_ seen: Int) async -> Bool {
    if state.versionAccepted { return true }
    guard seen == state.generation, let base = state.activeBase else { return false }
    do {
      let response = try await transport.perform(
        ControlRequest(method: "GET", path: "/meta", body: nil),
        to: base
      )
      guard seen == state.generation else { return false }
      let meta = try MetaRead.meta(status: response.status, body: response.body)
      try VersionGate.accept(meta)
      var next = state
      next.versionAccepted = true
      next.refusal = nil
      state = next
      return true
    } catch let error as VersionGateError {
      guard seen == state.generation else { return false }
      stopForVersion(error, base: base)
      return false
    } catch {
      if Task.isCancelled || seen != state.generation { return false }
      applyTransportFailure(generation: seen)
      return false
    }
  }

  private func stopForVersion(_ error: VersionGateError, base: RemoteBase) {
    let message: String
    switch error {
    case .missingVersion:
      message = "The Mac did not report a server version. The phone stopped."
    case .unsupported(let version):
      message =
        "The Mac runs server version \(version), which this phone cannot control. Update Pythinker on the Mac, then try again."
    }
    var next = state
    next.phase = .stopped(base, message)
    next.refusal = message
    next.versionAccepted = false
    next.socketUp = false
    next.generation += 1
    state = next
    listenID += 1
  }

  private func apply(
    _ response: ControlHTTPResult,
    dismiss: Bool,
    deliveredCode: Int?,
    action: Int,
    life: Int,
    onSuccess: (inout PhoneState) -> Void
  ) {
    guard action == actionID, life == state.generation else { return }
    let decoded = ResponsePath.decode(
      status: response.status, body: response.body, dismiss: dismiss)
    var next = state
    next.sendInFlight = false
    switch decoded.outcome {
    case .success, .alreadyResolved:
      next.banner = nil
      onSuccess(&next)
    case .failure(let code, _) where code == deliveredCode:
      next.banner = nil
      onSuccess(&next)
    case .failure(_, let message):
      next.banner = message.isEmpty ? "The request failed." : message
    }
    state = next
  }

  private func requireBase() throws -> RemoteBase {
    guard let base = state.activeBase else {
      throw ControlBuildError.rejectedID("")
    }
    return base
  }

  private func readLoop(_ id: String, seen: Int, listen: Int) async throws {
    var failures = 0
    while seen == state.generation, listen == listenID, !Task.isCancelled {
      do {
        let text = try await SocketWait.next(socket, within: receiveDeadline)
        guard seen == state.generation, listen == listenID else { return }
        if let reply = SocketFrames.pong(for: text) {
          try await socket.send(reply)
          continue
        }
        var next = state
        if InteractionFrames.apply(text, to: &next) {
          state = next
          failures = 0
          continue
        }
        let effect = next.transcript.apply(frame: text)
        state = next
        if effect == .applied {
          failures = 0
        }
        if effect == .resync {
          guard seen == state.generation, listen == listenID else { return }
          _ = try await recover(sessionID: id)
        }
      } catch {
        if Task.isCancelled || seen != state.generation || listen != listenID { return }
        failures += 1
        if failures > Self.maxRecoveries {
          throw error
        }
        var down = state
        down.socketUp = false
        state = down
        try await Task.sleep(for: recoveryDelay * failures)
        guard seen == state.generation, listen == listenID else { return }
        _ = try await recover(sessionID: id)
      }
    }
  }
}
