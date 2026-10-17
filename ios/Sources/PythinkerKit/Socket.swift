import Foundation

public protocol EventSocket: Sendable {
  func open(_ url: URL) async throws
  func send(_ text: String) async throws
  func next() async throws -> String
  func close()
}

public struct NullEventSocket: EventSocket {
  public init() {}

  public func open(_ url: URL) async throws {}

  public func send(_ text: String) async throws {}

  public func next() async throws -> String {
    throw CancellationError()
  }

  public func close() {}
}

public enum SocketFrameError: Error, Equatable {
  case encoding
  case timedOut
}

public enum SocketWait {
  public static func next(_ socket: any EventSocket, within limit: Duration) async throws -> String
  {
    try await withThrowingTaskGroup(of: String.self) { group in
      group.addTask { try await socket.next() }
      group.addTask {
        try await Task.sleep(for: limit)
        throw SocketFrameError.timedOut
      }
      guard let first = try await group.next() else {
        throw SocketFrameError.timedOut
      }
      group.cancelAll()
      return first
    }
  }
}

public enum SocketConnect {
  public static func webSocketTask(session: URLSession, url: URL) -> URLSessionWebSocketTask {
    session.webSocketTask(with: url)
  }
}

public final class LiveEventSocket: EventSocket, @unchecked Sendable {
  private let lock = NSLock()
  private let session: URLSession
  private var task: URLSessionWebSocketTask?

  public init(session: URLSession = PhoneHTTP.makeSession()) {
    self.session = session
  }

  public func open(_ url: URL) async throws {
    let task = SocketConnect.webSocketTask(session: session, url: url)
    task.resume()
    replace(task)?.cancel(with: .goingAway, reason: nil)
  }

  public func send(_ text: String) async throws {
    try await current().send(.string(text))
  }

  public func next() async throws -> String {
    let task = try current()
    let message = try await withTaskCancellationHandler {
      try await task.receive()
    } onCancel: {
      task.cancel(with: .goingAway, reason: nil)
    }
    switch message {
    case .string(let text):
      return text
    case .data(let data):
      guard let text = String(data: data, encoding: .utf8) else {
        throw SocketFrameError.encoding
      }
      return text
    @unknown default:
      throw SocketFrameError.encoding
    }
  }

  public func close() {
    replace(nil)?.cancel(with: .goingAway, reason: nil)
  }

  private func current() throws -> URLSessionWebSocketTask {
    lock.lock()
    defer { lock.unlock() }
    guard let task else { throw LinkParseError.socketURL }
    return task
  }

  private func replace(_ task: URLSessionWebSocketTask?) -> URLSessionWebSocketTask? {
    lock.lock()
    let previous = self.task
    self.task = task
    lock.unlock()
    return previous
  }
}
