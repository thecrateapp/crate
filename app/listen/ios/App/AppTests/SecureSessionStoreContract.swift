import Foundation

@main
enum SecureSessionStoreContract {
    static func main() throws {
        let service = "app.cratemusic.crate.contract.\(UUID().uuidString)"
        let store = CrateSecureSessionStore(service: service)
        let sessionKey = "crate.session.contract"
        let oauthKey = "crate.oauth.contract"
        let value = #"{"token":"secret","refreshToken":"refresh"}"#

        defer {
            _ = try? store.clearPrefix("crate.session.")
            _ = try? store.clearPrefix("crate.oauth.")
        }

        try store.set(key: sessionKey, value: value)
        guard try store.get(key: sessionKey) == value else {
            fatalError("Keychain round trip did not preserve the value")
        }

        try store.set(key: oauthKey, value: #"{"verifier":"value"}"#)
        guard try store.listKeys(prefix: "crate.session.") == [sessionKey] else {
            fatalError("Keychain prefix listing leaked another namespace")
        }

        try store.remove(key: sessionKey)
        guard try store.get(key: sessionKey) == nil else {
            fatalError("Keychain removal did not delete the entry")
        }

        guard (try? store.set(key: "invalid", value: value)) == nil else {
            fatalError("Invalid secure-session namespace was accepted")
        }
        guard (try? store.set(key: oauthKey, value: "not-json")) == nil else {
            fatalError("Non-JSON secure-session value was accepted")
        }
    }
}
