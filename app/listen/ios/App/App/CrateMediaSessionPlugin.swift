import AVFoundation
import AVKit
import Capacitor
import MediaPlayer
import UIKit

@objc(CrateMediaSessionPlugin)
class CrateMediaSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateMediaSessionPlugin"
    let jsName = "CrateMediaSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getOutputCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentRoutePicker", returnType: CAPPluginReturnPromise)
    ]

    private var remoteCommandTokens: [Any] = []
    private var artworkRequestId = 0
    private var routePickerOverlay: UIView?
    private var routePickerDismissWorkItem: DispatchWorkItem?

    override func load() {
        super.load()
        configureAudioSession()
        configureRemoteCommands()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChanged),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        let commandCenter = MPRemoteCommandCenter.shared()
        for token in remoteCommandTokens {
            commandCenter.playCommand.removeTarget(token)
            commandCenter.pauseCommand.removeTarget(token)
            commandCenter.nextTrackCommand.removeTarget(token)
            commandCenter.previousTrackCommand.removeTarget(token)
            commandCenter.changePlaybackPositionCommand.removeTarget(token)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        update(call)
    }

    @objc func update(_ call: CAPPluginCall) {
        configureAudioSession()

        let title = call.getString("title", "Crate")
        let artist = call.getString("artist", "")
        let album = call.getString("album", "")
        let artwork = call.getString("artwork", "")
        let isPlaying = call.getBool("isPlaying", false)
        let duration = max(0, call.getDouble("duration", 0))
        let position = max(0, min(call.getDouble("position", 0), duration > 0 ? duration : call.getDouble("position", 0)))

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        loadArtwork(from: artwork, into: info)
        call.resolve()
    }

    @objc func getOutputCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            "canShowSystemOutputSwitcher": false,
            "canPresentRoutePicker": true,
            "canReportCurrentRoute": true,
            "routePickerKind": "ios-route-picker"
        ])
    }

    @objc func getCurrentRoute(_ call: CAPPluginCall) {
        call.resolve(["route": currentRoutePayload()])
    }

    @objc func presentRoutePicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let hostView = self.bridge?.viewController?.view else {
                call.resolve([
                    "shown": false,
                    "reason": "Could not open iOS route picker."
                ])
                return
            }

            self.configureAudioSession()
            self.dismissRoutePickerOverlay()

            let overlay = UIView(frame: hostView.bounds)
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.backgroundColor = UIColor.black.withAlphaComponent(0.35)

            let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterialDark))
            panel.frame = CGRect(
                x: max(16, (hostView.bounds.width - 220) / 2),
                y: max(80, (hostView.bounds.height - 180) / 2),
                width: min(220, hostView.bounds.width - 32),
                height: 180
            )
            panel.autoresizingMask = [
                .flexibleLeftMargin,
                .flexibleRightMargin,
                .flexibleTopMargin,
                .flexibleBottomMargin
            ]
            panel.layer.cornerRadius = 18
            panel.layer.masksToBounds = true
            overlay.addSubview(panel)

            let title = UILabel(frame: CGRect(x: 16, y: 18, width: panel.bounds.width - 32, height: 24))
            title.autoresizingMask = [.flexibleWidth]
            title.text = "Choose output"
            title.textAlignment = .center
            title.textColor = .white
            title.font = .systemFont(ofSize: 16, weight: .semibold)
            panel.contentView.addSubview(title)

            let picker = AVRoutePickerView(frame: CGRect(x: (panel.bounds.width - 64) / 2, y: 58, width: 64, height: 64))
            picker.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin]
            picker.prioritizesVideoDevices = false
            picker.tintColor = .white
            panel.contentView.addSubview(picker)

            let closeButton = UIButton(type: .system)
            closeButton.frame = CGRect(x: 16, y: 130, width: panel.bounds.width - 32, height: 34)
            closeButton.autoresizingMask = [.flexibleWidth]
            closeButton.setTitle("Close", for: .normal)
            closeButton.setTitleColor(.white, for: .normal)
            closeButton.addTarget(self, action: #selector(self.dismissRoutePickerOverlay), for: .touchUpInside)
            panel.contentView.addSubview(closeButton)

            hostView.addSubview(overlay)
            self.routePickerOverlay = overlay
            let dismissWorkItem = DispatchWorkItem { [weak self] in
                self?.dismissRoutePickerOverlay()
            }
            self.routePickerDismissWorkItem = dismissWorkItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 15.0, execute: dismissWorkItem)
            call.resolve(["shown": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        artworkRequestId += 1
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            NSLog("CrateMediaSessionPlugin failed to configure AVAudioSession: \(error.localizedDescription)")
        }
    }

    private func configureRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true

        remoteCommandTokens.append(commandCenter.playCommand.addTarget { [weak self] _ in
            self?.sendControl("play")
            return .success
        })
        remoteCommandTokens.append(commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.sendControl("pause")
            return .success
        })
        remoteCommandTokens.append(commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.sendControl("next")
            return .success
        })
        remoteCommandTokens.append(commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.sendControl("previous")
            return .success
        })
        remoteCommandTokens.append(commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.sendControl("seekTo", position: event.positionTime)
            return .success
        })
    }

    private func sendControl(_ control: String, position: Double? = nil) {
        var payload: [String: Any] = ["control": control]
        if let position {
            payload["position"] = position
        }
        notifyListeners("control", data: payload, retainUntilConsumed: true)
    }

    @objc private func handleRouteChanged() {
        dismissRoutePickerOverlay()
        notifyListeners(
            "routeChanged",
            data: ["route": currentRoutePayload()],
            retainUntilConsumed: true
        )
    }

    @objc private func dismissRoutePickerOverlay() {
        routePickerDismissWorkItem?.cancel()
        routePickerDismissWorkItem = nil
        routePickerOverlay?.removeFromSuperview()
        routePickerOverlay = nil
    }

    private func currentRoutePayload() -> [String: Any] {
        let output = AVAudioSession.sharedInstance().currentRoute.outputs.first
        return [
            "id": output?.uid ?? "ios-system-output",
            "name": output?.portName ?? "System output",
            "type": routeType(output?.portType),
            "platform": "ios"
        ]
    }

    private func routeType(_ portType: AVAudioSession.Port?) -> String {
        guard let portType else { return "system" }
        switch portType {
        case .airPlay:
            return "airplay"
        case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP:
            return "bluetooth"
        case .builtInReceiver, .builtInSpeaker:
            return "speaker"
        case .headphones, .lineOut:
            return "wired"
        case .carAudio:
            return "car"
        case .HDMI:
            return "hdmi"
        case .usbAudio:
            return "usb"
        default:
            return "system"
        }
    }

    private func loadArtwork(from artworkUrl: String, into baseInfo: [String: Any]) {
        guard let url = URL(string: artworkUrl), !artworkUrl.isEmpty else { return }
        artworkRequestId += 1
        let currentRequestId = artworkRequestId

        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard
                let self,
                currentRequestId == self.artworkRequestId,
                let data,
                let decodedArtwork = CrateArtworkDownsampler.decode(data: data)
            else { return }

            let image = UIImage(cgImage: decodedArtwork)
            let mediaArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard currentRequestId == self.artworkRequestId else { return }
                var nextInfo = baseInfo
                nextInfo[MPMediaItemPropertyArtwork] = mediaArtwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nextInfo
            }
        }.resume()
    }
}
