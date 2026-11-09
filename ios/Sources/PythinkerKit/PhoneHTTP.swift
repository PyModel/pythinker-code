import Foundation

public enum PhoneHTTP {
  public static let requestTimeout: TimeInterval = 20
  public static let resourceTimeout: TimeInterval = 60

  public static func apply(_ config: URLSessionConfiguration) {
    config.timeoutIntervalForRequest = requestTimeout
    config.timeoutIntervalForResource = resourceTimeout
    config.waitsForConnectivity = false
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
  }

  public static func makeSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    apply(config)
    return URLSession(configuration: config)
  }
}
