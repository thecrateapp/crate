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
    private static let protocolNamespace = "urn:x-cast:app.cratemusic.crate.v1"
    private var pendingRequestCall: CAPPluginCall?
    private var observedSession: GCKCastSession?
    private var observedClient: GCKRemoteMediaClient?
    private lazy var protocolChannel: GCKGenericChannel = {
        let channel = GCKGenericChannel(namespace: Self.protocolNamespace)
        channel.delegate = self
        return channel
    }()
    private struct PendingCastOperation {
        let call: CAPPluginCall
        let failureMessage: String
        let successMessage: String?
        let activatesSession: Bool
    }
    private var pendingOperations: [GCKRequestID: PendingCastOperation] = [:]
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
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getQueueSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueInsert", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueReorder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueSetRepeatMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueNext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queuePrevious", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueJumpTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endSession", returnType: CAPPluginReturnPromise)
    ]

    #if canImport(GoogleCast)
    override func load() {
        super.load()
        configureCastContext()
        GCKCastContext.sharedInstance().sessionManager.add(self)
        bindSession(GCKCastContext.sharedInstance().sessionManager.currentCastSession)
    }

    deinit {
        if Self.isCastContextConfigured() {
            GCKCastContext.sharedInstance().sessionManager.remove(self)
        }
        unbindSession()
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
            "targetName": session?.device.friendlyName as Any,
            "receiverApplicationId": configuredReceiverApplicationID()
        ]
        if !available {
            payload["reason"] = "No Cast receivers found on this network."
        }
        if let session {
            bindSession(session)
            addSessionMetadata(to: &payload, from: session)
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
        track(client.play(), call: call, failureMessage: "Could not resume Cast playback.")
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func pause(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        track(client.pause(), call: call, failureMessage: "Could not pause Cast playback.")
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func seek(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        let position = max(0, call.getDouble("currentTime", 0))
        let options = GCKMediaSeekOptions()
        options.interval = position
        track(
            client.seek(with: options),
            call: call,
            failureMessage: "Could not seek Cast playback."
        )
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
        track(
            session.setDeviceVolume(Float(volume)),
            call: call,
            failureMessage: "Could not set Cast volume."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func stop(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        track(client.stop(), call: call, failureMessage: "Could not stop Cast playback.")
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func getQueueSnapshot(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        guard let status = client.mediaStatus else {
            call.resolve(["available": false, "items": []])
            return
        }
        var items: [[String: Any]] = []
        for index in 0..<status.queueItemCount {
            guard let item = status.queueItem(at: index),
                  let stableID = stableItemID(item) else { continue }
            items.append(["stableId": stableID, "itemId": item.itemID])
        }
        call.resolve(["available": true, "items": items])
        #else
        call.resolve(["available": false, "items": []])
        #endif
    }

    @objc func queueInsert(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call),
              let rawItems = call.getArray("items") else { return }
        let items = buildQueueItems(rawItems)
        guard !items.isEmpty else {
            call.resolve(result(false, "Invalid Cast queue items."))
            return
        }
        let insertBefore = UInt(max(0, call.getInt("insertBefore", Int(kGCKMediaQueueInvalidItemID))))
        track(
            client.queueInsert(items, beforeItemWithID: insertBefore),
            call: call,
            failureMessage: "Could not insert Cast queue items."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queueRemove(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call),
              let rawIDs = call.getArray("itemIds") else { return }
        let itemIDs = rawIDs.compactMap { ($0 as? NSNumber) }
        track(
            client.queueRemoveItems(withIDs: itemIDs),
            call: call,
            failureMessage: "Could not remove Cast queue items."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queueReorder(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call),
              let rawIDs = call.getArray("itemIds") else { return }
        let itemIDs = rawIDs.compactMap { ($0 as? NSNumber) }
        track(
            client.queueReorderItems(
                withIDs: itemIDs,
                insertBeforeItemWithID: kGCKMediaQueueInvalidItemID
            ),
            call: call,
            failureMessage: "Could not reorder Cast queue items."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queueSetRepeatMode(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        track(
            client.queueSetRepeatMode(repeatMode(call.getString("repeatMode", "off"))),
            call: call,
            failureMessage: "Could not update Cast repeat mode."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queueNext(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        track(client.queueNextItem(), call: call, failureMessage: "Could not skip Cast item.")
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queuePrevious(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call) else { return }
        track(
            client.queuePreviousItem(),
            call: call,
            failureMessage: "Could not return to the previous Cast item."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func queueJumpTo(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        guard let client = remoteMediaClient(call),
              let status = client.mediaStatus else { return }
        let index = max(0, call.getInt("index", 0))
        guard index < status.queueItemCount,
              let item = status.queueItem(at: UInt(index)) else {
            call.resolve(result(false, "Cast queue item is unavailable."))
            return
        }
        track(
            client.queueJumpToItem(withID: item.itemID),
            call: call,
            failureMessage: "Could not select Cast queue item."
        )
        #else
        call.resolve(result(false, "Google Cast SDK is not linked in this iOS build."))
        #endif
    }

    @objc func endSession(_ call: CAPPluginCall) {
        #if canImport(GoogleCast)
        configureCastContext()
        let sessionManager = GCKCastContext.sharedInstance().sessionManager
        guard sessionManager.currentCastSession != nil else {
            call.resolve(result(true, nil))
            return
        }
        let stopCasting = call.getBool("stopCasting", true)
        guard sessionManager.endSessionAndStopCasting(stopCasting) else {
            call.resolve(result(false, "Could not end Cast session."))
            return
        }
        unbindSession()
        notifyListeners("sessionChanged", data: ["active": false], retainUntilConsumed: true)
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
        let criteria = GCKDiscoveryCriteria(
            applicationID: configuredReceiverApplicationID()
        )
        let options = GCKCastOptions(discoveryCriteria: criteria)
        GCKCastContext.setSharedInstanceWith(options)
        Self.castContextConfigured = true
        _ = GCKCastContext.sharedInstance()
    }

    private func configuredReceiverApplicationID() -> String {
        let configuredID = Bundle.main.object(
            forInfoDictionaryKey: "CrateCastReceiverApplicationID"
        ) as? String
        guard let configuredID,
              configuredID.range(
                  of: "^[A-Za-z0-9]{8}$",
                  options: .regularExpression
              ) != nil else {
            return kGCKDefaultMediaReceiverApplicationID
        }
        return configuredID
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
        bindSession(
            GCKCastContext.sharedInstance().sessionManager.currentCastSession
        )
        return client
    }

    private func track(
        _ request: GCKRequest,
        call: CAPPluginCall,
        failureMessage: String,
        successMessage: String? = nil,
        activatesSession: Bool = false
    ) {
        pendingOperations[request.requestID] = PendingCastOperation(
            call: call,
            failureMessage: failureMessage,
            successMessage: successMessage,
            activatesSession: activatesSession
        )
        request.delegate = self
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
        guard let client = session.remoteMediaClient else {
            call.resolve(result(false, "Cast receiver is not ready."))
            return
        }
        bindSession(session)

        if let rawItems = call.getArray("items") {
            let queueItems = buildQueueItems(rawItems)
            guard !queueItems.isEmpty else {
                call.resolve(result(false, "Cast queue is empty."))
                return
            }
            let startIndex = UInt(
                max(0, min(call.getInt("currentIndex", 0), queueItems.count - 1))
            )
            let customData: [String: Any] = [
                "crateCast": [
                    "protocolVersion": call.getInt("protocolVersion", 1),
                    "sessionId": call.getString("sessionId", ""),
                    "bootstrapUrl": call.getString("bootstrapUrl", "")
                ]
            ]
            let queueData = GCKMediaQueueDataBuilder(queueType: .generic)
            queueData.items = queueItems
            queueData.startIndex = startIndex
            queueData.repeatMode = repeatMode(call.getString("repeatMode", "off"))
            let request = GCKMediaLoadRequestDataBuilder()
            request.queueData = queueData.build()
            request.autoplay = true
            request.startTime = max(0, call.getDouble("currentTime", 0))
            request.customData = customData
            track(
                client.loadMedia(with: request.build()),
                call: call,
                failureMessage: "Could not load Cast queue.",
                successMessage: "Casting started.",
                activatesSession: true
            )
            return
        }

        let payload: [String: Any] = [
            "streamUrl": call.getString("streamUrl", ""),
            "contentType": call.getString("contentType", "audio/mpeg"),
            "title": call.getString("title", "Crate"),
            "artist": call.getString("artist", ""),
            "album": call.getString("album", ""),
            "artworkUrl": call.getString("artworkUrl", ""),
            "metadataUrl": call.getString("metadataUrl", ""),
            "duration": call.getDouble("duration", 0)
        ]
        guard let mediaInformation = buildMediaInformation(payload) else {
            call.resolve(result(false, "Invalid Cast stream URL."))
            return
        }

        let request = GCKMediaLoadRequestDataBuilder()
        request.mediaInformation = mediaInformation
        request.autoplay = true
        request.startTime = max(0, call.getDouble("currentTime", 0))
        track(
            client.loadMedia(with: request.build()),
            call: call,
            failureMessage: "Could not load Cast media.",
            successMessage: "Casting started.",
            activatesSession: true
        )
    }

    private func buildQueueItems(_ payload: [Any]) -> [GCKMediaQueueItem] {
        payload.compactMap { raw in
            guard let value = raw as? [String: Any],
                  let mediaInformation = buildMediaInformation(value) else { return nil }
            let builder = GCKMediaQueueItemBuilder()
            builder.mediaInformation = mediaInformation
            builder.autoplay = true
            builder.customData = value["customData"]
            return builder.build()
        }
    }

    private func buildMediaInformation(_ payload: [String: Any]) -> GCKMediaInformation? {
        guard let streamURL = payload["streamUrl"] as? String,
              !streamURL.isEmpty,
              let url = URL(string: streamURL) else { return nil }

        let metadata = GCKMediaMetadata(metadataType: .musicTrack)
        metadata.setString(payload["title"] as? String ?? "Crate", forKey: kGCKMetadataKeyTitle)
        metadata.setString(payload["artist"] as? String ?? "", forKey: kGCKMetadataKeyArtist)
        metadata.setString(payload["album"] as? String ?? "", forKey: kGCKMetadataKeyAlbumTitle)
        if let artwork = payload["artworkUrl"] as? String,
           let artworkUrl = URL(string: artwork) {
            metadata.addImage(GCKImage(url: artworkUrl, width: 512, height: 512))
        }

        let mediaInfoBuilder = GCKMediaInformationBuilder(contentURL: url)
        mediaInfoBuilder.contentType = payload["contentType"] as? String ?? "audio/mpeg"
        mediaInfoBuilder.streamType = .buffered
        mediaInfoBuilder.metadata = metadata
        let duration = (payload["duration"] as? NSNumber)?.doubleValue ?? 0
        if duration > 0 {
            mediaInfoBuilder.streamDuration = duration
        }
        if let customData = payload["customData"] as? [String: Any] {
            mediaInfoBuilder.customData = customData
        } else if let metadataUrl = payload["metadataUrl"] as? String,
                  !metadataUrl.isEmpty {
            mediaInfoBuilder.customData = ["metadataUrl": metadataUrl]
        }
        return mediaInfoBuilder.build()
    }

    private func repeatMode(_ value: String) -> GCKMediaRepeatMode {
        switch value {
        case "all": return .all
        case "one": return .single
        default: return .off
        }
    }

    private func bindSession(_ session: GCKCastSession?) {
        if observedSession === session { return }
        unbindSession()
        guard let session else { return }
        observedSession = session
        observedClient = session.remoteMediaClient
        observedClient?.add(self)
        _ = session.add(protocolChannel)
        publishPlaybackState()
    }

    private func unbindSession() {
        observedClient?.remove(self)
        if let observedSession {
            _ = observedSession.remove(protocolChannel)
        }
        observedClient = nil
        observedSession = nil
    }

    private func stableItemID(_ item: GCKMediaQueueItem) -> String? {
        let customData = item.mediaInformation.customData as? [String: Any]
            ?? item.customData as? [String: Any]
        let crateCast = customData?["crateCast"] as? [String: Any]
        return crateCast?["itemId"] as? String
    }

    private func addSessionMetadata(
        to payload: inout [String: Any],
        from session: GCKCastSession
    ) {
        let customData = session.remoteMediaClient?
            .mediaStatus?
            .mediaInformation?
            .customData as? [String: Any]
        let crateCast = customData?["crateCast"] as? [String: Any]
        if let sessionID = crateCast?["sessionId"] as? String, !sessionID.isEmpty {
            payload["sessionId"] = sessionID
        }
        if let bootstrapURL = crateCast?["bootstrapUrl"] as? String,
           !bootstrapURL.isEmpty {
            payload["bootstrapUrl"] = bootstrapURL
        }
    }

    private func sessionPayload(_ session: GCKCastSession?) -> [String: Any] {
        guard let session else { return ["active": false] }
        var payload: [String: Any] = [
            "active": true,
            "targetName": session.device.friendlyName ?? "Cast device"
        ]
        addSessionMetadata(to: &payload, from: session)
        return payload
    }

    private func publishPlaybackState() {
        let status = observedClient?.mediaStatus
        let duration = max(0, status?.mediaInformation?.streamDuration ?? 0)
        let position = max(0, observedClient?.approximateStreamPosition() ?? 0)
        var payload: [String: Any] = [
            "active": observedSession != nil,
            "currentTime": min(position, duration > 0 ? duration : position),
            "duration": duration,
            "isBuffering": status?.playerState == .buffering
                || status?.playerState == .loading,
            "isPlaying": status?.playerState == .playing
        ]
        if let status {
            let index = status.queueIndex(forItemID: status.currentItemID)
            if index >= 0 { payload["currentIndex"] = index }
            payload["volume"] = max(0, min(1, status.volume))
        }
        notifyListeners("playbackState", data: payload, retainUntilConsumed: true)
    }
    #endif
}

#if canImport(GoogleCast)
extension CrateCastPlugin: GCKSessionManagerListener {
    func sessionManager(_ sessionManager: GCKSessionManager, didStart session: GCKSession) {
        loadPendingMedia(session)
        let castSession = session as? GCKCastSession
        bindSession(castSession)
        notifyListeners(
            "sessionChanged",
            data: sessionPayload(castSession),
            retainUntilConsumed: true
        )
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didResume session: GCKSession) {
        loadPendingMedia(session)
        let castSession = session as? GCKCastSession
        bindSession(castSession)
        notifyListeners(
            "sessionChanged",
            data: sessionPayload(castSession),
            retainUntilConsumed: true
        )
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didEnd session: GCKSession, withError error: Error?) {
        resolvePending(false, "Cast session ended before playback started.")
        unbindSession()
        notifyListeners("sessionChanged", data: ["active": false], retainUntilConsumed: true)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didFailToStart session: GCKSession, withError error: Error) {
        resolvePending(false, "Could not start Cast session.")
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didFailToResumeSession sessionID: String, withError error: Error?) {
        resolvePending(false, "Could not resume Cast session.")
    }
}

extension CrateCastPlugin: GCKRequestDelegate {
    func requestDidComplete(_ request: GCKRequest) {
        guard let operation = pendingOperations.removeValue(forKey: request.requestID) else {
            return
        }
        var payload = result(true, operation.successMessage)
        if let targetName = GCKCastContext.sharedInstance()
            .sessionManager
            .currentCastSession?
            .device
            .friendlyName {
            payload["targetName"] = targetName
        }
        operation.call.resolve(payload)
        if operation.activatesSession {
            let session = GCKCastContext.sharedInstance()
                .sessionManager
                .currentCastSession
            bindSession(session)
            notifyListeners(
                "sessionChanged",
                data: sessionPayload(session),
                retainUntilConsumed: true
            )
            publishPlaybackState()
        }
    }

    func request(_ request: GCKRequest, didFailWithError error: GCKError) {
        guard let operation = pendingOperations.removeValue(forKey: request.requestID) else {
            return
        }
        operation.call.resolve(result(false, operation.failureMessage))
    }

    func request(_ request: GCKRequest, didAbortWith reason: GCKRequestAbortReason) {
        guard let operation = pendingOperations.removeValue(forKey: request.requestID) else {
            return
        }
        operation.call.resolve(result(false, operation.failureMessage))
    }
}

extension CrateCastPlugin: GCKRemoteMediaClientListener {
    func remoteMediaClient(
        _ client: GCKRemoteMediaClient,
        didUpdate mediaStatus: GCKMediaStatus?
    ) {
        publishPlaybackState()
    }

    func remoteMediaClient(
        _ client: GCKRemoteMediaClient,
        didUpdate mediaMetadata: GCKMediaMetadata?
    ) {
        publishPlaybackState()
    }

    func remoteMediaClientDidUpdateQueue(_ client: GCKRemoteMediaClient) {
        publishPlaybackState()
    }
}

extension CrateCastPlugin: GCKGenericChannelDelegate {
    func cast(
        _ channel: GCKGenericChannel,
        didReceiveTextMessage message: String,
        withNamespace protocolNamespace: String
    ) {
        notifyListeners(
            "protocolMessage",
            data: ["namespace": protocolNamespace, "message": message],
            retainUntilConsumed: true
        )
    }
}
#endif
