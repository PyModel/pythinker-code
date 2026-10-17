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
  @State private var path: [String] = []
  @State private var creating = false

  var body: some View {
    NavigationStack(path: $path) {
      switch desk.state.phase {
      case .unpaired:
        pairScreen
      case .confirm:
        confirmScreen
      case .paired, .offline:
        sessionsScreen
      case .stopped(_, let message):
        stoppedScreen(message)
      }
    }
    .confirmationDialog(
      "Forget the link to this Mac?", isPresented: $confirmForget, titleVisibility: .visible
    ) {
      Button("Forget link", role: .destructive) {
        path = []
        desk.forget()
      }
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

  private var pairScreen: some View {
    List {
      Section {
        BrandHeader(
          image: "BrandRobot", size: 120, title: "Pythinker",
          subtitle: "Follow and steer the coding sessions on your Mac from this phone.")
      }
      .listRowBackground(Color.clear)
      if let banner = desk.state.banner {
        Section {
          Callout(text: banner, systemImage: "exclamationmark.triangle.fill", tint: .orange)
        }
      }
      Section {
        PrimaryButton(title: "Scan QR code", systemImage: "qrcode.viewfinder") { scanning = true }
      }
      .listRowInsets(EdgeInsets())
      .listRowBackground(Color.clear)
      Section {
        TextField("Paste the Remote Control link", text: pasteBinding)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
        Button("Continue") { desk.stagePasted() }
          .disabled(desk.paste.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      } header: {
        Text("Or paste the link")
      } footer: {
        Text("On your Mac, run pythinker web --remote-control to show the code and the link.")
      }
    }
    .listSectionSpacing(.compact)
  }

  private var confirmScreen: some View {
    List {
      Section {
        BrandHeader(
          image: "MascotWaving", size: 64, title: "Pair with this Mac?",
          subtitle: desk.state.relayHost.map { "Relay: \($0)" } ?? "")
      }
      .listRowBackground(Color.clear)
      Section {
        Callout(
          text: "Anyone with this link can control this Mac. Save it only on your own phone.",
          systemImage: "lock.shield.fill", tint: .orange)
      }
      Section {
        PrimaryButton(title: "Save link", systemImage: "checkmark") { desk.saveConfirmed() }
      }
      .listRowInsets(EdgeInsets())
      .listRowBackground(Color.clear)
      Section {
        Button("Back", role: .cancel) { desk.forget() }
      }
    }
    .navigationTitle("Confirm")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var isOffline: Bool {
    if case .offline = desk.state.phase { return true }
    return false
  }

  private var sessionsScreen: some View {
    List {
      if isOffline {
        Section {
          Callout(
            text: "Offline. The phone cannot reach the Mac.", systemImage: "wifi.slash",
            tint: .orange)
          Button("Retry") { desk.refreshSessions() }
        }
      }
      if let banner = desk.state.banner {
        Section {
          Callout(text: banner, systemImage: "exclamationmark.triangle.fill", tint: .orange)
          Button("OK") { desk.clearBanner() }
        }
      }
      if !desk.state.workspaces.isEmpty {
        Section {
          workspacePicker
        }
      }
      Section {
        if desk.state.sessions.isEmpty {
          if desk.state.isLoading {
            HStack {
              Spacer()
              ProgressView()
              Spacer()
            }
          } else {
            EmptyState(
              image: "MascotIdle", title: "No sessions yet",
              message: desk.state.selectedWorkspace == nil
                ? "Start a session on your Mac, or choose a workspace and tap New session."
                : "Tap New session to start one in this workspace.")
          }
        }
        ForEach(desk.state.sessions) { row in
          NavigationLink(value: row.id) {
            HStack(spacing: 12) {
              Text(row.title.isEmpty ? row.id : row.title)
                .font(.body.weight(.medium))
                .lineLimit(2)
              Spacer(minLength: 8)
              StatusChip(activity: row.activity)
            }
            .padding(.vertical, 4)
          }
        }
      } header: {
        Text(desk.state.selectedWorkspace.map { "Sessions in \($0.name)" } ?? "Sessions")
      } footer: {
        if let host = desk.state.relayHost {
          Text("Connected through \(host)")
        }
      }
    }
    .refreshable { desk.refreshSessions() }
    .navigationTitle("Pythinker")
    .navigationDestination(for: String.self) { id in
      sessionDetail(id)
        .onAppear { desk.select(id) }
    }
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        ConnectionBadge(online: !isOffline)
      }
      ToolbarItem(placement: .topBarTrailing) {
        newSessionButton
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button {
            desk.refreshSessions()
          } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
          }
          Button(role: .destructive) {
            confirmForget = true
          } label: {
            Label("Forget link", systemImage: "trash")
          }
        } label: {
          Image(systemName: "ellipsis.circle")
            .accessibilityLabel("More")
        }
      }
    }
  }

  private var workspacePicker: some View {
    Picker(selection: workspaceSelection) {
      Text("All workspaces").tag(String?.none)
      ForEach(desk.state.workspaces) { workspace in
        Text("\(workspace.name) (\(workspace.sessionCount))").tag(Optional(workspace.id))
      }
    } label: {
      Label("Workspace", systemImage: "folder")
    }
    .pickerStyle(.menu)
  }

  private var workspaceSelection: Binding<String?> {
    Binding(
      get: { desk.state.selectedWorkspaceID },
      set: { desk.selectWorkspace($0) }
    )
  }

  @ViewBuilder
  private var newSessionButton: some View {
    if desk.state.selectedWorkspace != nil {
      Button {
        startSession()
      } label: {
        Label("New session", systemImage: "square.and.pencil")
      }
      .disabled(creating || isOffline)
    } else {
      Menu {
        ForEach(desk.state.workspaces) { workspace in
          Button(workspace.name) {
            desk.selectWorkspace(workspace.id)
            startSession()
          }
        }
      } label: {
        Label("New session", systemImage: "square.and.pencil")
      }
      .disabled(creating || isOffline || desk.state.workspaces.isEmpty)
    }
  }

  private func startSession() {
    creating = true
    Task {
      defer { creating = false }
      if let id = await desk.createSession() {
        path.append(id)
      }
    }
  }

  private func sessionTitle(_ id: String) -> String {
    let title = desk.state.sessions.first { $0.id == id }?.title ?? ""
    return title.isEmpty ? id : title
  }

  private func sessionDetail(_ id: String) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        if isOffline {
          Callout(
            text: "Offline. The phone cannot reach the Mac.", systemImage: "wifi.slash",
            tint: .orange)
        }
        if let banner = desk.state.banner {
          Callout(text: banner, systemImage: "exclamationmark.triangle.fill", tint: .orange)
        }
        let transcript = desk.state.transcript
        if transcript.assistantText.isEmpty && transcript.tools.isEmpty {
          EmptyState(
            image: "MascotIdle", title: "Nothing here yet",
            message: "Replies and tool calls from the agent show here."
          )
          .padding(.top, 48)
        }
        ForEach(transcript.tools) { tool in
          ToolRow(tool: tool)
        }
        if !transcript.assistantText.isEmpty {
          Text(transcript.assistantText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .padding(14)
            .background(
              Color(.secondarySystemGroupedBackground),
              in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
      .padding()
    }
    .defaultScrollAnchor(.bottom)
    .background(Color(.systemGroupedBackground))
    .navigationTitle(sessionTitle(id))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button(role: .destructive) {
          desk.stop()
        } label: {
          Label("Stop", systemImage: "stop.circle")
        }
        .disabled(!desk.state.canStop)
      }
    }
    .safeAreaInset(edge: .bottom) {
      composer
    }
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !desk.state.socketUp && !isOffline {
        Text("Connecting to the session…")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Message Pythinker", text: draftBinding, axis: .vertical)
          .lineLimit(1...5)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(
            Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        Button {
          desk.sendPrompt()
        } label: {
          Image(systemName: "arrow.up.circle.fill")
            .font(.system(size: 34))
        }
        .disabled(!desk.state.canSend)
        .accessibilityLabel("Send")
      }
    }
    .padding(.horizontal)
    .padding(.vertical, 10)
    .background(.bar)
  }

  private func stoppedScreen(_ message: String) -> some View {
    List {
      Section {
        BrandHeader(
          image: "MascotFailed", size: 64, title: "Cannot use this Mac", subtitle: message)
      }
      .listRowBackground(Color.clear)
      Section {
        PrimaryButton(title: "Try again", systemImage: "arrow.clockwise") {
          desk.retryAfterStop()
        }
      }
      .listRowInsets(EdgeInsets())
      .listRowBackground(Color.clear)
      Section {
        Button("Forget link", role: .destructive) { confirmForget = true }
      }
    }
    .navigationTitle("Stopped")
    .navigationBarTitleDisplayMode(.inline)
  }

  @ViewBuilder
  private var sheetStatus: some View {
    if isOffline {
      Section {
        Callout(
          text: "Offline. Your choice cannot reach the Mac.", systemImage: "wifi.slash",
          tint: .orange)
        Button("Retry") { desk.refreshSessions() }
      }
    }
    if let banner = desk.state.banner {
      Section {
        Callout(text: banner, systemImage: "exclamationmark.triangle.fill", tint: .orange)
        Button("OK") { desk.clearBanner() }
      }
    }
  }

  private var approvalSheet: some View {
    NavigationStack {
      List {
        sheetStatus
        if let approval = desk.state.approval {
          Section {
            HStack(spacing: 14) {
              Image("MascotReview")
                .resizable()
                .scaledToFit()
                .frame(width: 44, height: 48)
                .accessibilityHidden(true)
              VStack(alignment: .leading, spacing: 2) {
                Text(approval.toolName)
                  .font(.headline)
                Text(approval.action)
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
              }
            }
            if desk.state.approvals.count > 1 {
              Text("\(desk.state.approvals.count) approvals are waiting.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
          }
          Section("Details") {
            ScrollView {
              Text(approval.inputDisplay)
                .font(.system(.footnote, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }
            .frame(maxHeight: 320)
          }
          Section {
            if desk.state.scopeConfirmed {
              Label(
                "Approve will also allow \(approval.toolName) like this for the rest of the session.",
                systemImage: "checkmark.seal.fill"
              )
              .font(.footnote)
            } else {
              Button("Remember for this session") { confirmScope = true }
                .disabled(desk.state.selectedSessionID == nil || !approval.canDecide)
            }
          }
        }
      }
      .navigationTitle("Approval needed")
      .navigationBarTitleDisplayMode(.inline)
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 10) {
          PrimaryButton(title: "Approve", systemImage: "checkmark") { desk.decide(.approved) }
            .disabled(!desk.state.canApprove)
          HStack(spacing: 10) {
            Button(role: .destructive) {
              desk.decide(.rejected)
            } label: {
              Text("Reject").frame(maxWidth: .infinity)
            }
            .disabled(!desk.state.canReject)
            Button {
              desk.decide(.cancelled)
            } label: {
              Text("Cancel").frame(maxWidth: .infinity)
            }
            .disabled(!desk.state.canReject)
          }
          .buttonStyle(.bordered)
          .controlSize(.large)
        }
        .padding()
        .background(.bar)
      }
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
      List {
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
                      .foregroundStyle(.primary)
                    Spacer()
                    if desk.state.isChosen(itemID: item.id, optionID: option.id) {
                      Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                    }
                  }
                }
              }
              if item.allowOther {
                TextField(item.otherLabel, text: otherBinding(item.id))
              }
            } header: {
              Text(item.prompt)
                .textCase(nil)
                .font(.headline)
                .foregroundStyle(.primary)
            } footer: {
              if item.multiSelect {
                Text("Pick one or more.")
              }
            }
          }
        }
      }
      .navigationTitle("Question")
      .navigationBarTitleDisplayMode(.inline)
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 10) {
          PrimaryButton(title: "Answer", systemImage: "paperplane.fill") { desk.answer() }
            .disabled(!desk.state.canAnswer)
          Button {
            desk.dismiss()
          } label: {
            Text("Dismiss").frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
          .controlSize(.large)
          .disabled(!desk.state.canDismiss)
        }
        .padding()
        .background(.bar)
      }
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

struct BrandHeader: View {
  let image: String
  let size: CGFloat
  let title: String
  let subtitle: String

  var body: some View {
    VStack(spacing: 10) {
      Image(image)
        .resizable()
        .scaledToFit()
        .frame(width: size, height: size)
        .accessibilityHidden(true)
      Text(title)
        .font(.title.bold())
      if !subtitle.isEmpty {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .padding(.vertical, 8)
  }
}

struct PrimaryButton: View {
  let title: String
  let systemImage: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: systemImage)
        .labelStyle(.titleAndIcon)
        .font(.headline)
        .frame(maxWidth: .infinity)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.large)
  }
}

struct Callout: View {
  let text: String
  let systemImage: String
  let tint: Color

  var body: some View {
    Label {
      Text(text)
    } icon: {
      Image(systemName: systemImage)
        .foregroundStyle(tint)
    }
    .font(.subheadline)
  }
}

struct EmptyState: View {
  let image: String
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 8) {
      Image(image)
        .resizable()
        .scaledToFit()
        .frame(width: 48, height: 52)
        .accessibilityHidden(true)
      Text(title)
        .font(.headline)
      Text(message)
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .padding(.vertical, 16)
  }
}

struct StatusChip: View {
  let activity: String

  private var style: (label: String, tint: Color) {
    switch activity {
    case "running": ("Running", .accentColor)
    case "approval": ("Needs approval", .orange)
    case "question": ("Has a question", .orange)
    case "failed": ("Failed", .red)
    default: ("Idle", .secondary)
    }
  }

  var body: some View {
    Text(style.label)
      .font(.caption.weight(.semibold))
      .foregroundStyle(style.tint)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(style.tint.opacity(0.14), in: Capsule())
  }
}

struct ConnectionBadge: View {
  let online: Bool

  var body: some View {
    HStack(spacing: 5) {
      Circle()
        .fill(online ? Color.green : Color.secondary)
        .frame(width: 8, height: 8)
      Text(online ? "Online" : "Offline")
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
    }
    .fixedSize()
    .accessibilityElement(children: .combine)
  }
}

struct ToolRow: View {
  let tool: ToolCard

  var body: some View {
    HStack(spacing: 10) {
      Group {
        switch tool.status {
        case "running":
          ProgressView()
            .controlSize(.small)
        case "failed":
          Image(systemName: "xmark.octagon.fill")
            .foregroundStyle(.red)
        default:
          Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(.green)
        }
      }
      .frame(width: 22)
      Text(tool.name)
        .font(.system(.subheadline, design: .monospaced).weight(.medium))
        .lineLimit(1)
      Spacer()
      Text(tool.status.capitalized)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(
      Color(.secondarySystemGroupedBackground),
      in: RoundedRectangle(cornerRadius: 12, style: .continuous)
    )
    .accessibilityElement(children: .combine)
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
