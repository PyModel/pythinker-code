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
  private var actionID: Int

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
    self.actionID = 0
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
    if state.selectedSessionID == id { return }
    var next = state
    next.selectedSessionID = id
    next.approval = nil
    next.question = nil
    next.selectedItemID = nil
    next.selectedOptionID = nil
    next.scopeConfirmed = false
    next.transcript = SessionTranscript()
    next.socketUp = false
    next.banner = nil
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
    await performPrompt(begin())
  }

  public func stopNow() async {
    await performStop(begin())
  }

  public func decideNow(_ decision: ApprovalDecision) async {
    await performDecision(decision, seen: begin())
  }

  public func answerNow() async {
    await performAnswer(begin())
  }

  public func dismissNow() async {
    await performDismiss(begin())
  }

  public func followSelected() async {
    guard let id = state.selectedSessionID, state.activeBase != nil else { return }
    let seen = state.generation
    let listen = listenID
    startPing(seen, listen: listen)
    defer {
      pingTask?.cancel()
      pingTask = nil
    }
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

  public func pingNow() async {
    try? await socket.ping()
  }

  public func recover(sessionID: String) async throws -> String {
    let seen = state.generation
    let listen = listenID
    guard await acceptVersion(seen) else { throw CancellationError() }
    guard listen == listenID else { throw CancellationError() }
    let base = try requireBase()
    let id = try ResourceID.segment(sessionID)
    if state.socketUp,
      let beat = SocketFrames.pong(for: #"{"type":"ping","payload":{"nonce":"hold"}}"#)
    {
      try await socket.send(beat)
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
    let frame = try SocketFrames.subscribe(
      sessionIDs: [id],
      cursors: [id: SubscribeCursor(seq: view.asOfSeq, epoch: view.epoch)]
    )
    if !state.socketUp {
      try await socket.open(try base.socketURL())
    }
    guard seen == state.generation, listen == listenID else { throw CancellationError() }
    var next = state
    next.transcript = view.transcript
    next.approval = view.approval
    next.question = view.question
    if view.approval == nil {
      next.scopeConfirmed = false
    }
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
    inflight?.cancel()
    inflight = task
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
      if case .offline(let linked) = next.phase {
        next.phase = .paired(linked)
      }
      next.banner = nil
      state = next
      if recovering, seen == state.generation {
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
      request: { try self.state.promptRequest() },
      onSuccess: { next in
        next.draft = ""
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

  private func performDecision(_ decision: ApprovalDecision, seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: false,
      request: {
        try self.state.approvalRequest(decision: decision.rawValue)
      },
      onSuccess: { next in
        next.approval = nil
        next.scopeConfirmed = false
      }
    )
  }

  private func performAnswer(_ seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: false,
      request: { try self.state.answerRequest() },
      onSuccess: { next in
        next.question = nil
        next.selectedItemID = nil
        next.selectedOptionID = nil
      }
    )
  }

  private func performDismiss(_ seen: Int) async {
    await performPost(
      seen: seen,
      dismiss: true,
      request: { try self.state.dismissRequest() },
      onSuccess: { next in
        next.question = nil
        next.selectedItemID = nil
        next.selectedOptionID = nil
      }
    )
  }

  private func performPost(
    seen: Int,
    dismiss: Bool,
    request: () throws -> ControlRequest,
    onSuccess: (inout PhoneState) -> Void
  ) async {
    let life = state.generation
    guard seen == actionID, life == state.generation else { return }
    guard await acceptVersion(life) else { return }
    guard seen == actionID, life == state.generation else { return }
    let built: ControlRequest
    do {
      built = try request()
    } catch {
      return
    }
    guard let base = state.activeBase else { return }
    do {
      let response = try await transport.perform(built, to: base)
      guard seen == actionID, life == state.generation, !Task.isCancelled else { return }
      apply(response, dismiss: dismiss, action: seen, life: life, onSuccess: onSuccess)
    } catch {
      if Task.isCancelled || seen != actionID || life != state.generation { return }
      applyTransportFailure(generation: life)
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
    next.generation += 1
    state = next
    listenID += 1
  }

  private func apply(
    _ response: ControlHTTPResult,
    dismiss: Bool,
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

  private func startPing(_ seen: Int, listen: Int) {
    pingTask?.cancel()
    pingTask = Task { @MainActor in
      while seen == self.state.generation, listen == self.listenID, !Task.isCancelled {
        try? await Task.sleep(for: self.pingInterval)
        if Task.isCancelled || seen != self.state.generation || listen != self.listenID { return }
        await self.pingNow()
      }
    }
  }

  private func readLoop(_ id: String, seen: Int, listen: Int) async throws {
    var recovered = false
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
          continue
        }
        let effect = next.transcript.apply(frame: text)
        state = next
        if effect == .resync {
          guard seen == state.generation, listen == listenID else { return }
          _ = try await recover(sessionID: id)
        }
      } catch {
        if Task.isCancelled || seen != state.generation || listen != listenID { return }
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
