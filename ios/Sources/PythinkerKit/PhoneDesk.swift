import Foundation
import Observation

@MainActor
@Observable
public final class PhoneDesk {
  public var state: PhoneState
  public var paste: String
  public private(set) var listenID: Int
  public var receiveDeadline: Duration = .seconds(20)
  public var pingInterval: Duration = .seconds(15)

  private let transport: any GatewayTransport
  private let store: any LinkStore
  private let socket: any EventSocket
  private var inflight: Task<Void, Never>?
  private var pingTask: Task<Void, Never>?

  public init(
    transport: any GatewayTransport,
    store: any LinkStore,
    socket: any EventSocket = NullEventSocket(),
    state: PhoneState = PhoneState()
  ) {
    self.transport = transport
    self.store = store
    self.socket = socket
    self.state = state
    self.paste = ""
    self.listenID = 0
  }

  public func stagePasted() {
    do {
      var next = state
      try next.stageLink(paste)
      next.banner = nil
      state = next
    } catch {
      var next = state
      next.banner = "That link is not a Remote Control device link."
      state = next
    }
  }

  public func stageScanned(_ raw: String) {
    do {
      var next = state
      try next.stageLink(raw)
      next.banner = nil
      state = next
    } catch {
      var next = state
      next.banner = "That code is not a Remote Control link."
      state = next
    }
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
    let seen = state.generation
    track(Task { await self.refreshSessions(seen) })
  }

  public func forget() {
    inflight?.cancel()
    inflight = nil
    pingTask?.cancel()
    pingTask = nil
    socket.close()
    var next = state
    next.forget()
    state = next
    paste = ""
    try? store.forget()
    listenID += 1
  }

  public func restore() async {
    guard let url = try? store.load() else { return }
    guard let base = try? RemoteLink.parse(url.absoluteString) else {
      try? store.forget()
      return
    }
    paste = ""
    var next = state
    next.phase = .paired(base)
    next.banner = nil
    state = next
    await refreshSessions(state.generation)
  }

  public func refreshSessions() {
    let seen = state.generation
    track(Task { await self.refreshSessions(seen) })
  }

  public func select(_ id: String) {
    guard (try? ResourceID.segment(id)) != nil else { return }
    var next = state
    next.selectedSessionID = id
    state = next
    listenID += 1
  }

  public func chooseOption(itemID: String, optionID: String) {
    var next = state
    next.selectedItemID = itemID
    next.selectedOptionID = optionID
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
    let seen = begin()
    track(Task { await self.performDecision(decision, seen: seen) })
  }

  public func answer() {
    let seen = begin()
    track(Task { await self.performAnswer(seen) })
  }

  public func dismiss() {
    let seen = begin()
    track(Task { await self.performDismiss(seen) })
  }

  public func sendPromptNow() async {
    await performPrompt(state.generation)
  }

  public func stopNow() async {
    await performStop(state.generation)
  }

  public func decideNow(_ decision: ApprovalDecision) async {
    await performDecision(decision, seen: state.generation)
  }

  public func answerNow() async {
    await performAnswer(state.generation)
  }

  public func dismissNow() async {
    await performDismiss(state.generation)
  }

  public func followSelected() async {
    guard let id = state.selectedSessionID, state.activeBase != nil else { return }
    let seen = state.generation
    startPing(seen)
    defer {
      pingTask?.cancel()
      pingTask = nil
    }
    do {
      _ = try await recover(sessionID: id)
      try await readLoop(id, seen: seen)
    } catch is CancellationError {
      return
    } catch {
      if Task.isCancelled || seen != state.generation { return }
      applyTransportFailure(generation: seen)
    }
  }

  public func pingNow() async {
    try? await socket.ping()
  }

  public func recover(sessionID: String) async throws -> String {
    let seen = state.generation
    guard await acceptVersion(seen) else { throw CancellationError() }
    let base = try requireBase()
    let id = try ResourceID.segment(sessionID)
    let response = try await transport.perform(
      ControlRequest(method: "GET", path: "/sessions/\(id)/snapshot", body: nil),
      to: base
    )
    guard seen == state.generation else { throw CancellationError() }
    let decoded = ResponsePath.decode(status: response.status, body: response.body, dismiss: false)
    guard case .success = decoded.outcome else {
      throw ControlBuildError.badResponse
    }
    let view = try SnapshotDecoder.decode(response.body)
    let frame = try SocketFrames.subscribe(
      sessionIDs: [id],
      cursors: [id: SubscribeCursor(seq: view.asOfSeq, epoch: view.epoch)]
    )
    var next = state
    next.transcript = view.transcript
    next.approval = view.approval
    next.question = view.question
    if view.approval == nil {
      next.scopeConfirmed = false
    }
    state = next
    if !state.socketUp {
      try await socket.open(try base.socketURL())
    }
    guard seen == state.generation else { throw CancellationError() }
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

  private func begin() -> Int {
    var next = state
    next.generation += 1
    state = next
    return state.generation
  }

  private func track(_ task: Task<Void, Never>) {
    inflight?.cancel()
    inflight = task
  }

  private func refreshSessions(_ seen: Int) async {
    guard await acceptVersion(seen) else { return }
    guard seen == state.generation, let base = state.activeBase else { return }
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
      let response = try await transport.perform(
        ControlRequest(method: "GET", path: "/sessions", body: nil),
        to: base
      )
      guard seen == state.generation else { return }
      let rows = try SessionListDecoder.rows(status: response.status, body: response.body)
      var next = state
      next.sessions = rows
      if let selected = next.selectedSessionID, !rows.contains(where: { $0.id == selected }) {
        next.selectedSessionID = nil
        next.socketUp = false
      }
      next.banner = nil
      state = next
    } catch {
      if Task.isCancelled || seen != state.generation { return }
      applyTransportFailure(generation: seen)
    }
  }

  private func performPrompt(_ seen: Int) async {
    var next = state
    next.sendInFlight = true
    state = next
    defer {
      if seen == state.generation {
        var done = state
        done.sendInFlight = false
        state = done
      }
    }
    await performPost(seen: seen, dismiss: false, request: { try self.state.promptRequest() }) {
      next in
      next.draft = ""
    }
  }

  private func performStop(_ seen: Int) async {
    await performPost(seen: seen, dismiss: false, request: { try self.state.abortRequest() }) { _ in
    }
  }

  private func performDecision(_ decision: ApprovalDecision, seen: Int) async {
    await performPost(
      seen: seen, dismiss: false,
      request: {
        try self.state.approvalRequest(decision: decision.rawValue)
      }
    ) { next in
      next.approval = nil
      next.scopeConfirmed = false
    }
  }

  private func performAnswer(_ seen: Int) async {
    await performPost(seen: seen, dismiss: false, request: { try self.state.answerRequest() }) {
      next in
      next.question = nil
      next.selectedItemID = nil
      next.selectedOptionID = nil
    }
  }

  private func performDismiss(_ seen: Int) async {
    await performPost(seen: seen, dismiss: true, request: { try self.state.dismissRequest() }) {
      next in
      next.question = nil
      next.selectedItemID = nil
      next.selectedOptionID = nil
    }
  }

  private func performPost(
    seen: Int,
    dismiss: Bool,
    request: () throws -> ControlRequest,
    onSuccess: (inout PhoneState) -> Void
  ) async {
    guard await acceptVersion(seen) else { return }
    guard seen == state.generation else { return }
    let built: ControlRequest
    do {
      built = try request()
    } catch {
      return
    }
    guard let base = state.activeBase else { return }
    do {
      let response = try await transport.perform(built, to: base)
      guard seen == state.generation, !Task.isCancelled else { return }
      apply(response, dismiss: dismiss, seen: seen, onSuccess: onSuccess)
    } catch {
      if Task.isCancelled || seen != state.generation { return }
      applyTransportFailure(generation: seen)
    }
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
      let version = try MetaRead.serverVersion(status: response.status, body: response.body)
      try VersionGate.acceptPinned(version)
      var next = state
      next.versionAccepted = true
      next.refusal = nil
      state = next
      return true
    } catch let error as VersionGateError {
      guard seen == state.generation else { return false }
      stopForVersion(error)
      return false
    } catch {
      if Task.isCancelled || seen != state.generation { return false }
      applyTransportFailure(generation: seen)
      return false
    }
  }

  private func stopForVersion(_ error: VersionGateError) {
    let message: String
    switch error {
    case .unknown(let version):
      if version.isEmpty {
        message = "The Mac did not report a server version. The phone stopped."
      } else {
        message =
          "Unknown server version \(version). The phone stopped and did not send the prompt."
      }
    }
    var next = state
    next.phase = .stopped(message)
    next.refusal = message
    next.versionAccepted = false
    next.socketUp = false
    state = next
  }

  private func apply(
    _ response: ControlHTTPResult,
    dismiss: Bool,
    seen: Int,
    onSuccess: (inout PhoneState) -> Void
  ) {
    guard seen == state.generation else { return }
    let decoded = ResponsePath.decode(
      status: response.status, body: response.body, dismiss: dismiss)
    var next = state
    next.sendInFlight = false
    switch decoded.outcome {
    case .success:
      next.banner = nil
      onSuccess(&next)
    case .alreadyResolved:
      next.approval = nil
      next.question = nil
      next.selectedItemID = nil
      next.selectedOptionID = nil
      next.scopeConfirmed = false
      next.banner = nil
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

  private func startPing(_ seen: Int) {
    pingTask?.cancel()
    pingTask = Task { @MainActor in
      while seen == self.state.generation, !Task.isCancelled {
        try? await Task.sleep(for: self.pingInterval)
        if Task.isCancelled || seen != self.state.generation { return }
        await self.pingNow()
      }
    }
  }

  private func readLoop(_ id: String, seen: Int) async throws {
    var recovered = false
    while seen == state.generation, !Task.isCancelled {
      do {
        let text = try await SocketWait.next(socket, within: receiveDeadline)
        guard seen == state.generation else { return }
        var next = state
        let effect = next.transcript.apply(frame: text)
        state = next
        if effect == .resync {
          _ = try await recover(sessionID: id)
        }
      } catch {
        if Task.isCancelled || seen != state.generation { return }
        if recovered {
          throw error
        }
        recovered = true
        var down = state
        down.socketUp = false
        state = down
        _ = try await recover(sessionID: id)
      }
    }
  }
}
