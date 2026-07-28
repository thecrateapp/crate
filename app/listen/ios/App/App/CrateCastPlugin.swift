import Capacitor
import Foundation
import UIKit

#if canImport(GoogleCast)
import GoogleCast
#endif

@objc(CrateCastPlugin)
class CrateCastPlugin: CAPPlugin, CAPBridgedPlugin {
    #if canImport(GoogleCast)
    private static let castContextLock = NSLock()
    private static var castContextConfigured = false
    private var pendingRequestCall: CAPPluginCall?
    #endif

    let identifier = "CrateCastPlugin"
    let jsName = "CrateCast"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    #if canImport(GoogleCast)
    override func load() {
        super.load()
        configureCastContext()
        GCKCastContext.sharedInstance().sessionManager.add(self)
    }

    deinit {
        if Self.isCastContextConfigured() {
            GCKCastContext.sharedInstance().sessionManager.remove(self)
        }
    }
    #endif

    @objc func getCapabilities(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        configureCastContext()
        let context = GCKCastContext.sharedInstance()
        let session = context.sessionManager.currentCastSession
        let active = session != nil
        let available = active || context.castState != .noDevicesAvailable
        var payload: [String: Any] = [
            "platform": "native",
            "visible": true,
            "available": available,
            "activeSession": active,
            "targetName": session?.device.friendlyName as Any
        ]
        if !available {
            payload["reason"] = "No Cast receivers found on this network."
        }
        call.resolve(payload)
        #else
        call.resolve(unavailable("Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func requestSession(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        configureCastContext()
        if let session = GCKCastContext.sharedInstance().sessionManager.currentCastSession {
            loadMedia(call, session: session)
            return
        }
        replacePendingCall(with: call)
        presentCastPicker(call)
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func play(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        client.play()
        call.resolve(result(true, nil))
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func pause(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        client.pause()
        call.resolve(result(true, nil))
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func seek(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        let position = max(0, call.getDouble("currentTime", 0))
        client.seek(toTimeInterval: position)
        call.resolve(result(true, nil))
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        configureCastContext()
        guard let session = GCKCastContext.sharedInstance().sessionManager.currentCastSession else {
            call.resolve(result(false, "No active Cast media session."))
            return
        }
        let volume = max(0, min(1, call.getDouble("volume", 1)))
        session.setDeviceVolume(Float(volume))
        call.resolve(result(true, nil))
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func stop(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        client.stop()
        call.resolve(result(true, nil))
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    private func unavailable(_ reason: String) -> [String: Any] {
        [
            "platform": "native",
            "visible": false,
            "available": false,
            "activeSession": false,
            "reason": reason
        ]
    }

    private func result(_ ok: Bool, _ message: String?) -> [String: Any] {
        var payload: [String: Any] = ["ok": ok]
        if let message {
            payload["message"] = message
        }
        return payload
    }

    #if canImport(GoogleCast)
    private static func isCastContextConfigured() -> Bool {
        castContextLock.lock()
        defer { castContextLock.unlock() }
        return castContextConfigured
    }

    private func configureCastContext() {
        Self.castContextLock.lock()
        defer { Self.castContextLock.unlock() }
        if Self.castContextConfigured { return }
        let criteria = GCKDiscoveryCriteria(applicationID: kGCKDefaultMediaReceiverApplicationID)
        let options = GCKCastOptions(discoveryCriteria: criteria)
        GCKCastContext.setSharedInstanceWith(options)
        Self.castContextConfigured = true
        _ = GCKCastContext.sharedInstance()
    }

    private func remoteMediaClient(_ call: CAPPluginCall) -> GCKRemoteMediaClient? {
        configureCastContext()
        guard let client = GCKCastContext.sharedInstance()
            .sessionManager
            .currentCastSession?
            .remoteMediaClient else {
            call.resolve(result(false, "No active Cast media session."))
            return nil
        }
        return client
    }

    private func presentCastPicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve([
                    "ok": false,
                    "message": "Could not open the Cast device picker."
                ])
                return
            }
            self.configureCastContext()
            GCKCastContext.sharedInstance().presentCastDialog()
            self.schedulePendingTimeout(call)
        }
    }

    private func replacePendingCall(with call: CAPPluginCall) {
        resolvePending(false, "Another Cast request replaced this one.")
        pendingRequestCall = call
    }

    private func schedulePendingTimeout(_ call: CAPPluginCall) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 60.0) { [weak self, weak call] in
            guard let self, let call, self.pendingRequestCall === call else { return }
            self.resolvePending(false, "Cast session was not started.")
        }
    }

    private func loadPendingMedia(_ session: GCKSession) {
        guard let call = pendingRequestCall else { return }
        guard let castSession = session as? GCKCastSession else {
            resolvePending(false, "Cast receiver is not ready.")
            return
        }
        pendingRequestCall = nil
        loadMedia(call, session: castSession)
    }

    private func resolvePending(_ ok: Bool, _ message: String) {
        pendingRequestCall?.resolve(result(ok, message))
        pendingRequestCall = nil
    }

    private func loadMedia(_ call: CAPPluginCall, session: GCKCastSession) {
        guard let streamUrl = call.getString("streamUrl"),
              !streamUrl.isEmpty,
              let url = URL(string: streamUrl) else {
            call.resolve(result(false, "Invalid Cast stream URL."))
            return
        }
        guard let client = session.remoteMediaClient else {
            call.resolve(result(false, "Cast receiver is not ready."))
            return
        }

        let metadata = GCKMediaMetadata(metadataType: .musicTrack)
        metadata.setString(call.getString("title", "Crate"), forKey: kGCKMetadataKeyTitle)
        metadata.setString(call.getString("artist", ""), forKey: kGCKMetadataKeyArtist)
        metadata.setString(call.getString("album", ""), forKey: kGCKMetadataKeyAlbumTitle)
        if let artwork = call.getString("artworkUrl"), let artworkUrl = URL(string: artwork) {
            metadata.addImage(GCKImage(url: artworkUrl, width: 512, height: 512))
        }

        let mediaInfoBuilder = GCKMediaInformationBuilder(contentURL: url)
        mediaInfoBuilder.contentType = call.getString("contentType", "audio/mpeg")
        mediaInfoBuilder.streamType = .buffered
        mediaInfoBuilder.metadata = metadata
        let duration = call.getDouble("duration", 0)
        if duration > 0 {
            mediaInfoBuilder.streamDuration = duration
        }
        if let metadataUrl = call.getString("metadataUrl") {
            mediaInfoBuilder.customData = ["metadataUrl": metadataUrl]
        }

        let request = GCKMediaLoadRequestDataBuilder()
        request.mediaInformation = mediaInfoBuilder.build()
        request.autoplay = true
        request.startTime = max(0, call.getDouble("currentTime", 0))
        client.loadMedia(with: request.build())
        call.resolve(result(true, "Casting started."))
        notifyListeners("sessionChanged", data: ["active": true], retainUntilConsumed: true)
    }
    #endif
}

#if canImport(GoogleCast)
extension CrateCastPlugin: GCKSessionManagerListener {
    func sessionManager(_ sessionManager: GCKSessionManager, didStart session: GCKSession) {
        loadPendingMedia(session)
        notifyListeners("sessionChanged", data: ["active": true], retainUntilConsumed: true)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didResume session: GCKSession) {
        loadPendingMedia(session)
        notifyListeners("sessionChanged", data: ["active": true], retainUntilConsumed: true)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didEnd session: GCKSession, withError error: Error?) {
        resolvePending(false, "Cast session ended before playback started.")
        notifyListeners("sessionChanged", data: ["active": false], retainUntilConsumed: true)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didFailToStart session: GCKSession, withError error: Error) {
        resolvePending(false, "Could not start Cast session.")
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didFailToResumeSession sessionID: String, withError error: Error?) {
        resolvePending(false, "Could not resume Cast session.")
    }
}
#endif
