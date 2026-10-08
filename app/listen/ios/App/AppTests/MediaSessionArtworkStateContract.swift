import Foundation

@main
struct MediaSessionArtworkStateContract {
    static func main() {
        var state = CrateMediaSessionArtworkState()

        guard let first = state.beginRequest(for: "https://example.com/first.jpg") else {
            fatalError("A valid artwork URL should start a request")
        }
        precondition(state.isCurrent(first.id))

        precondition(state.beginRequest(for: "") == nil)
        precondition(!state.isCurrent(first.id))
        precondition(state.pendingUrl == nil)

        guard let second = state.beginRequest(for: "https://example.com/second.jpg") else {
            fatalError("A replacement artwork URL should start a request")
        }
        precondition(state.beginRequest(for: "https://example.com/second.jpg") == nil)
        precondition(state.isCurrent(second.id))

        precondition(state.beginRequest(for: "%") == nil)
        precondition(!state.isCurrent(second.id))
        precondition(state.pendingUrl == nil)

        guard let third = state.beginRequest(for: "https://example.com/third.jpg") else {
            fatalError("Artwork should retry after an invalid replacement")
        }
        state.cancelPendingRequest()
        precondition(!state.isCurrent(third.id))
        precondition(state.pendingUrl == nil)

        state.stop()
        precondition(!state.isCurrent(third.id))
        precondition(state.pendingUrl == nil)
    }
}
