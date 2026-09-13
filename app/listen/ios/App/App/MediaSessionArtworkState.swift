import Foundation

struct CrateMediaSessionArtworkRequest {
    let id: Int
    let url: URL
    let urlString: String
}

struct CrateMediaSessionArtworkState {
    private var requestId = 0
    private(set) var pendingUrl: String?

    mutating func beginRequest(for artworkUrl: String) -> CrateMediaSessionArtworkRequest? {
        if pendingUrl == artworkUrl {
            return nil
        }
        requestId += 1
        pendingUrl = nil
        guard
            !artworkUrl.isEmpty,
            let url = URL(string: artworkUrl),
            ["http", "https"].contains(url.scheme?.lowercased()),
            url.host != nil
        else {
            return nil
        }
        pendingUrl = artworkUrl
        return CrateMediaSessionArtworkRequest(
            id: requestId,
            url: url,
            urlString: artworkUrl
        )
    }

    func isCurrent(_ id: Int) -> Bool {
        id == requestId
    }

    mutating func complete(_ request: CrateMediaSessionArtworkRequest) -> Bool {
        guard isCurrent(request.id), pendingUrl == request.urlString else {
            return false
        }
        pendingUrl = nil
        return true
    }

    mutating func cancelPendingRequest() {
        guard pendingUrl != nil else { return }
        requestId += 1
        pendingUrl = nil
    }

    mutating func stop() {
        requestId += 1
        pendingUrl = nil
    }
}
