import Foundation

public struct StreamCursor: Equatable, Sendable {
  public var textLength: Int

  public init(textLength: Int = 0) {
    self.textLength = textLength
  }

  public mutating func apply(offset: Int, chunk: String) -> Bool {
    if offset < textLength {
      return false
    }
    textLength = offset + chunk.utf16.count
    return true
  }
}
