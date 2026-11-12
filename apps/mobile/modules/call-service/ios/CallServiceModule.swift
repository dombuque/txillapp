import AVFoundation
import ExpoModulesCore

/**
 * O viva-voz das chamadas no iPhone (a mesma ponte TxCallService do Android, só com a parte do som; o serviço em
 * primeiro plano é coisa do Android). Ver src/lib/calls/speaker.ts.
 *
 * - setSpeaker(on): a sessão de áudio fica em playAndRecord / voiceChat (o que o WebRTC também usa) e a saída vai para
 *   o altifalante (`overrideOutputAudioPort(.speaker)`) ou volta à rota normal (`.none`): o auscultador do telemóvel,
 *   ou os auscultadores / o Bluetooth se estiverem ligados.
 * - audioRoute(): por onde sai o som e que auscultadores estão ligados.
 * - resetAudio(): fim da chamada; tira o override, volta ao modo .default e deixa de ouvir as mudanças de rota. A
 *   categoria volta pelo expo-audio (setAudioModeAsync no callAudio(false) do JS, que corre antes).
 * - evento onAudioRoute: a rota mudou (auscultadores ligados ou tirados, ou o WebRTC mudou a categoria).
 *
 * O iOS desfaz o override do altifalante quando a rota ou a categoria mudam. Se o WebRTC trocar a categoria a meio
 * (ao arrancar o som da chamada), volta-se a pôr o altifalante, desde que não haja auscultadores ligados.
 *
 * Escrito sem Mac para compilar: rever no primeiro build de iOS.
 */
private let bluetoothPorts: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE]
private let wiredPorts: Set<AVAudioSession.Port> = [.headphones, .usbAudio, .lineOut]

public class CallServiceModule: Module {
  private var wantSpeaker = false
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("TxCallService")

    Events("onAudioRoute")

    Function("setSpeaker") { (on: Bool) -> String in
      self.wantSpeaker = on
      self.watch()
      self.apply()
      let route = self.currentRoute()
      self.report()
      return route
    }

    Function("audioRoute") { () -> [String: String] in
      return ["route": self.currentRoute(), "headset": self.headset()]
    }

    Function("resetAudio") {
      self.unwatch()
      self.wantSpeaker = false
      let session = AVAudioSession.sharedInstance()
      try? session.overrideOutputAudioPort(.none)
      // O expo-audio já voltou à categoria normal; o modo voiceChat só faz sentido em chamada.
      if session.mode == .voiceChat { try? session.setMode(.default) }
    }

    OnDestroy {
      self.unwatch()
    }
  }

  /** playAndRecord / voiceChat com Bluetooth (HFP), e o altifalante por cima se for pedido. */
  private func apply() {
    let session = AVAudioSession.sharedInstance()
    do {
      if session.category != .playAndRecord || session.mode != .voiceChat {
        #if compiler(>=6.2)
        let options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP]
        #else
        let options: AVAudioSession.CategoryOptions = [.allowBluetooth]
        #endif
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
      }
      try session.overrideOutputAudioPort(wantSpeaker ? .speaker : .none)
    } catch {
      NSLog("[TxCallService] Não deu para trocar a saída do som: \(error.localizedDescription)")
    }
  }

  private func currentRoute() -> String {
    guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType else { return "unknown" }
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .headphones, .usbAudio, .lineOut: return "wired"
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
    default: return "unknown"
    }
  }

  /** Auscultadores ligados: pela rota atual ou, com o altifalante por cima, pelas entradas disponíveis. */
  private func headset() -> String {
    let session = AVAudioSession.sharedInstance()
    let outputs = session.currentRoute.outputs.map { $0.portType }
    let inputs = (session.availableInputs ?? []).map { $0.portType }
    if outputs.contains(where: { bluetoothPorts.contains($0) }) || inputs.contains(.bluetoothHFP) {
      return "bluetooth"
    }
    if outputs.contains(where: { wiredPorts.contains($0) }) || inputs.contains(.headsetMic) || inputs.contains(.usbAudio) {
      return "wired"
    }
    return "none"
  }

  private func report() {
    sendEvent("onAudioRoute", ["route": currentRoute(), "headset": headset()])
  }

  private func watch() {
    if observer != nil { return }
    observer = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
    ) { [weak self] note in
      self?.routeChanged(note)
    }
  }

  private func unwatch() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
  }

  private func routeChanged(_ note: Notification) {
    let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
    let reason = AVAudioSession.RouteChangeReason(rawValue: raw) ?? .unknown
    // O WebRTC (ou outra parte da app) mudou a categoria e o override caiu: volta a pôr o altifalante.
    if wantSpeaker && headset() == "none" && currentRoute() != "speaker" && (reason == .categoryChange || reason == .override || reason == .routeConfigurationChange) {
      try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.speaker)
    }
    report()
  }
}
