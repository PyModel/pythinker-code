import AVFoundation
import PythinkerKit
import Security
import SwiftUI
import Vision
import VisionKit

@main
struct PythinkerApp: App {
  var body: some Scene {
    WindowGroup {
      PhoneRoot()
    }
  }
}

struct PhoneRoot: View {
  @State private var desk = PhoneRoot.makeDesk()

  private static func makeDesk() -> PhoneDesk {
    let session = PhoneHTTP.makeSession()
    return PhoneDesk(
      transport: LiveControlTransport(session: session),
      store: KeychainLinkStore(),
      socket: LiveEventSocket(session: session)
    )
  }
  @State private var scanning = false
  @State private var confirmScope = false
  @State private var confirmForget = false

  var body: some View {
    NavigationStack {
      switch desk.state.phase {
      case .unpaired:
        pairForm
      case .confirm:
        confirmForm
      case .paired, .offline:
        sessionForm
      case .stopped(_, let message):
        stoppedForm(message)
      }
    }
    .confirmationDialog(
      "Forget the link to this Mac?", isPresented: $confirmForget, titleVisibility: .visible
    ) {
      Button("Forget link", role: .destructive) { desk.forget() }
    } message: {
      Text("You will need the Remote Control link again to pair.")
    }
    .sheet(isPresented: $scanning) {
      ScanSheet { raw in
        scanning = false
        desk.stageScanned(raw)
      }
    }
    .sheet(isPresented: approvalPresented) {
      approvalSheet
        .interactiveDismissDisabled(true)
    }
    .sheet(isPresented: questionPresented) {
      questionSheet
        .interactiveDismissDisabled(true)
    }
    .task {
      await desk.restore()
    }
    .task(id: desk.listenID) {
      await desk.followSelected()
    }
  }

  private var pairForm: some View {
    Form {
      if let banner = desk.state.banner {
        Text(banner)
      }
      TextField("Remote Control link", text: pasteBinding)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      Button("Scan code") { scanning = true }
      Button("Continue") { desk.stagePasted() }
        .disabled(desk.paste.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    .navigationTitle("Pair")
  }

  private var confirmForm: some View {
    Form {
      Text("Anyone with this link can control this Mac. Save it only on your own phone.")
      if let host = desk.state.relayHost {
        Text("Relay host: \(host)")
      }
      Button("Save") { desk.saveConfirmed() }
      Button("Back", role: .cancel) { desk.forget() }
    }
    .navigationTitle("Confirm")
  }

  private var sessionForm: some View {
    Form {
      if case .offline = desk.state.phase {
        Text("Offline")
        Button("Retry") { desk.refreshSessions() }
      }
      if let host = desk.state.relayHost {
        Text("Relay host: \(host)")
      }
      if let banner = desk.state.banner {
        Text(banner)
      }
      Section("Sessions") {
        if desk.state.isLoading {
          Text("Loading")
        }
        if desk.state.sessions.isEmpty {
          Text("No sessions")
        }
        ForEach(desk.state.sessions) { row in
          Button {
            desk.select(row.id)
          } label: {
            HStack {
              VStack(alignment: .leading) {
                Text(row.title.isEmpty ? row.id : row.title)
                Text(row.activity)
              }
              Spacer()
              if desk.state.selectedSessionID == row.id {
                Image(systemName: "checkmark")
              }
            }
          }
        }
        Button("Refresh") { desk.refreshSessions() }
      }
      Section("Transcript") {
        if desk.state.transcript.assistantText.isEmpty {
          Text("No assistant text yet")
        } else {
          Text(desk.state.transcript.assistantText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
        }
        ForEach(desk.state.transcript.tools) { tool in
          VStack(alignment: .leading, spacing: 4) {
            Text(tool.name)
              .font(.headline)
            Text(tool.status)
              .font(.subheadline)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(8)
          .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
        }
      }
      TextField("Prompt", text: draftBinding)
      Button("Send") { desk.sendPrompt() }
        .disabled(!desk.state.canSend)
      Button("Stop") { desk.stop() }
        .disabled(!desk.state.canStop)
      Button("Approve") { desk.decide(.approved) }
        .disabled(!desk.state.canApprove)
      Button("Reject") { desk.decide(.rejected) }
        .disabled(!desk.state.canReject)
      Button("Cancel approval") { desk.decide(.cancelled) }
        .disabled(!desk.state.canReject)
      Button("Answer") { desk.answer() }
        .disabled(!desk.state.canAnswer)
      Button("Dismiss") { desk.dismiss() }
        .disabled(!desk.state.canDismiss)
      Button("Forget link", role: .destructive) { confirmForget = true }
    }
    .navigationTitle("Sessions")
  }

  private func stoppedForm(_ message: String) -> some View {
    Form {
      Text(message)
      Button("Try again") { desk.retryAfterStop() }
      Button("Forget link", role: .destructive) { confirmForget = true }
    }
    .navigationTitle("Stopped")
  }

  @ViewBuilder
  private var sheetStatus: some View {
    if case .offline = desk.state.phase {
      Section {
        Text("Offline. Your choice cannot reach the Mac.")
        Button("Retry") { desk.refreshSessions() }
      }
    }
    if let banner = desk.state.banner {
      Section {
        Text(banner)
        Button("OK") { desk.clearBanner() }
      }
    }
  }

  private var approvalSheet: some View {
    NavigationStack {
      Form {
        sheetStatus
        if let approval = desk.state.approval {
          if desk.state.approvals.count > 1 {
            Text("\(desk.state.approvals.count) approvals are waiting.")
          }
          Text(approval.toolName)
            .font(.headline)
          Text(approval.action)
          ScrollView {
            Text(approval.inputDisplay)
              .font(.system(.body, design: .monospaced))
              .frame(maxWidth: .infinity, alignment: .leading)
              .textSelection(.enabled)
          }
          .frame(maxHeight: 320)
          Button("Approve") { desk.decide(.approved) }
            .disabled(!desk.state.canApprove)
          Button("Reject") { desk.decide(.rejected) }
            .disabled(!desk.state.canReject)
          Button("Cancel") { desk.decide(.cancelled) }
            .disabled(!desk.state.canReject)
          if desk.state.scopeConfirmed {
            Text(
              "Approve will also allow \(approval.toolName) like this for the rest of the session.")
          } else {
            Button("Remember for this session") { confirmScope = true }
              .disabled(desk.state.selectedSessionID == nil || !approval.canDecide)
          }
        }
      }
      .navigationTitle("Approval")
      .alert("Remember this approval for the rest of the session?", isPresented: $confirmScope) {
        Button("Remember") { desk.confirmSessionScope() }
        Button("Not now", role: .cancel) {}
      } message: {
        Text(
          "\(desk.state.approval?.toolName ?? "This tool") will run like this again without asking until the session ends."
        )
      }
    }
  }

  private var questionSheet: some View {
    NavigationStack {
      Form {
        sheetStatus
        if let question = desk.state.question {
          ForEach(question.items) { item in
            Section {
              ForEach(item.options) { option in
                Button {
                  desk.chooseOption(itemID: item.id, optionID: option.id)
                } label: {
                  HStack {
                    Text(option.label)
                    Spacer()
                    if desk.state.isChosen(itemID: item.id, optionID: option.id) {
                      Image(systemName: "checkmark")
                    }
                  }
                }
              }
              if item.allowOther {
                TextField(item.otherLabel, text: otherBinding(item.id))
              }
            } header: {
              Text(item.prompt)
            } footer: {
              if item.multiSelect {
                Text("Pick one or more.")
              }
            }
          }
          Button("Answer") { desk.answer() }
            .disabled(!desk.state.canAnswer)
          Button("Dismiss") { desk.dismiss() }
            .disabled(!desk.state.canDismiss)
        }
      }
      .navigationTitle("Question")
    }
  }

  private func otherBinding(_ itemID: String) -> Binding<String> {
    Binding(
      get: { desk.state.otherText[itemID] ?? "" },
      set: { desk.setOtherText(itemID: itemID, text: $0) }
    )
  }

  private var approvalPresented: Binding<Bool> {
    Binding(
      get: { desk.state.approval != nil },
      set: { _ in }
    )
  }

  private var questionPresented: Binding<Bool> {
    Binding(
      get: { desk.state.approval == nil && desk.state.question != nil },
      set: { _ in }
    )
  }

  private var pasteBinding: Binding<String> {
    Binding(
      get: { desk.paste },
      set: { desk.paste = $0 }
    )
  }

  private var draftBinding: Binding<String> {
    Binding(
      get: { desk.state.draft },
      set: { value in
        var next = desk.state
        next.draft = value
        next.banner = nil
        desk.state = next
      }
    )
  }
}

struct ScanSheet: View {
  var onCode: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var camera = AVCaptureDevice.authorizationStatus(for: .video)

  var body: some View {
    NavigationStack {
      Group {
        switch camera {
        case .authorized:
          if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
            DataCodeScanner(onCode: onCode)
          } else {
            VisionCodeScanner(onCode: onCode)
          }
        case .notDetermined:
          ProgressView()
            .task {
              _ = await AVCaptureDevice.requestAccess(for: .video)
              camera = AVCaptureDevice.authorizationStatus(for: .video)
            }
        default:
          Text("Camera access is off. Turn it on in Settings, or paste the link instead.")
            .padding()
        }
      }
      .navigationTitle("Scan")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
      }
    }
  }
}

struct DataCodeScanner: UIViewControllerRepresentable {
  var onCode: (String) -> Void

  func makeUIViewController(context: Context) -> DataScannerHost {
    let host = DataScannerHost()
    host.onCode = onCode
    return host
  }

  func updateUIViewController(_ host: DataScannerHost, context: Context) {
    host.onCode = onCode
  }
}

final class DataScannerHost: UIViewController, DataScannerViewControllerDelegate {
  var onCode: ((String) -> Void)?
  private var scanner: DataScannerViewController?
  private var delivered = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    guard DataScannerViewController.isSupported else { return }
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true,
      isGuidanceEnabled: true,
      isHighlightingEnabled: true
    )
    scanner.delegate = self
    addChild(scanner)
    scanner.view.frame = view.bounds
    scanner.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(scanner.view)
    scanner.didMove(toParent: self)
    self.scanner = scanner
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    try? scanner?.startScanning()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    scanner?.stopScanning()
  }

  func dataScanner(
    _ dataScanner: DataScannerViewController,
    didAdd addedItems: [RecognizedItem],
    allItems: [RecognizedItem]
  ) {
    guard !delivered else { return }
    for item in addedItems {
      guard case .barcode(let barcode) = item, let text = barcode.payloadStringValue else {
        continue
      }
      delivered = true
      dataScanner.stopScanning()
      onCode?(text)
      return
    }
  }
}

struct VisionCodeScanner: UIViewControllerRepresentable {
  var onCode: (String) -> Void

  func makeUIViewController(context: Context) -> VisionScanController {
    let controller = VisionScanController()
    controller.onCode = onCode
    return controller
  }

  func updateUIViewController(_ controller: VisionScanController, context: Context) {
    controller.onCode = onCode
  }
}

final class VisionScanController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
  var onCode: ((String) -> Void)?
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "pythinker.scan")
  private var delivered = false
  private var preview: AVCaptureVideoPreviewLayer?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    guard let device = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      return
    }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else { return }
    session.addOutput(output)
    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)
    self.preview = preview
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if !session.isRunning {
      session.startRunning()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if session.isRunning {
      session.stopRunning()
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  nonisolated func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .right)
    try? handler.perform([request])
    guard let text = request.results?.compactMap(\.payloadStringValue).first else { return }
    Task { @MainActor in
      self.deliver(text)
    }
  }

  private func deliver(_ text: String) {
    guard !delivered else { return }
    delivered = true
    session.stopRunning()
    onCode?(text)
  }
}

struct KeychainLinkStore: LinkStore {
  func save(baseURL: URL) throws {
    let data = Data(baseURL.absoluteString.utf8)
    let query = LinkKeychain.query()
    SecItemDelete(query as CFDictionary)
    var insert = query
    insert[kSecValueData as String] = data
    let status = SecItemAdd(insert as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainStoreError(status: status) }
  }

  func load() throws -> URL? {
    var query = LinkKeychain.query()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess,
      let data = item as? Data,
      let text = String(data: data, encoding: .utf8)
    else {
      throw KeychainStoreError(status: status)
    }
    return URL(string: text)
  }

  func forget() throws {
    let status = SecItemDelete(LinkKeychain.query() as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound { return }
    throw KeychainStoreError(status: status)
  }
}

struct KeychainStoreError: Error {
  let status: OSStatus
}
