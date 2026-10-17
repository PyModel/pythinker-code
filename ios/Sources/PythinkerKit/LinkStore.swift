import Foundation

public protocol LinkStore: Sendable {
    func save(baseURL: URL) throws
    func load() throws -> URL?
    func forget() throws
}

public final class MemoryLinkStore: LinkStore, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: URL?

    public init() {}

    public func save(baseURL: URL) throws {
        lock.lock()
        stored = baseURL
        lock.unlock()
    }

    public func load() throws -> URL? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    public func forget() throws {
        lock.lock()
        stored = nil
        lock.unlock()
    }
}
