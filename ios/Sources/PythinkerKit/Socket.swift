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

public enum SocketConnect {
    public static func webSocketTask(session: URLSession, url: URL) -> URLSessionWebSocketTask {
        session.webSocketTask(with: url)
    }
}

public final class LiveEventSocket: EventSocket, @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?

    public init() {}

    public func open(_ url: URL) async throws {
        let task = SocketConnect.webSocketTask(session: .shared, url: url)
        task.resume()
        replace(task)?.cancel(with: .goingAway, reason: nil)
    }

    public func send(_ text: String) async throws {
        try await current().send(.string(text))
    }

    public func next() async throws -> String {
        let message = try await current().receive()
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
