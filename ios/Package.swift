// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "PythinkerKit",
  platforms: [
    .iOS(.v18),
    .macOS(.v15),
  ],
  products: [
    .library(name: "PythinkerKit", targets: ["PythinkerKit"])
  ],
  targets: [
    .target(name: "PythinkerKit"),
    .testTarget(name: "PythinkerKitTests", dependencies: ["PythinkerKit"]),
  ]
)
