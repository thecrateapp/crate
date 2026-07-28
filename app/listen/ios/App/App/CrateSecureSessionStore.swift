import Foundation
import Security

final class CrateSecureSessionStore {
    private static let keyPattern = try! NSRegularExpression(
        pattern: #"^crate\.(session|oauth)\.[A-Za-z0-9._~-]+$"#
    )
    private static let validPrefixes = Set(["crate.session.", "crate.oauth."])

    private let service: String

    init(service: String = "app.cratemusic.crate") {
        self.service = service
    }

    func get(key: String) throws -> String? {
        try validate(key: key)
        let query = baseQuery(key: key).merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw StoreError.keychain
        }
        return value
    }

    func set(key: String, value: String) throws {
        try validate(key: key)
        try validate(value: value)

        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String:
                kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let insert = baseQuery(key: key).merging(attributes) { _, new in new }
        let status = SecItemAdd(insert as CFDictionary, nil)
        if status == errSecDuplicateItem {
            guard SecItemUpdate(
                baseQuery(key: key) as CFDictionary,
                attributes as CFDictionary
            ) == errSecSuccess else {
                throw StoreError.keychain
            }
            return
        }
        guard status == errSecSuccess else {
            throw StoreError.keychain
        }
    }

    func remove(key: String) throws {
        try validate(key: key)
        let status = SecItemDelete(baseQuery(key: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw StoreError.keychain
        }
    }

    func listKeys(prefix: String) throws -> [String] {
        try validate(prefix: prefix)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return []
        }
        guard status == errSecSuccess else {
            throw StoreError.keychain
        }

        let rows: [[String: Any]]
        if let multiple = result as? [[String: Any]] {
            rows = multiple
        } else if let single = result as? [String: Any] {
            rows = [single]
        } else {
            rows = []
        }

        return rows.compactMap { $0[kSecAttrAccount as String] as? String }
            .filter { $0.hasPrefix(prefix) && Self.isValidKey($0) }
            .sorted()
    }

    @discardableResult
    func clearPrefix(_ prefix: String) throws -> Int {
        let matching = try listKeys(prefix: prefix)
        for key in matching {
            try remove(key: key)
        }
        return matching.count
    }

    private func baseQuery(key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    private func validate(key: String) throws {
        guard Self.isValidKey(key) else {
            throw StoreError.invalidKey
        }
    }

    private func validate(prefix: String) throws {
        guard Self.validPrefixes.contains(prefix) else {
            throw StoreError.invalidPrefix
        }
    }

    private func validate(value: String) throws {
        guard !value.isEmpty,
              value.utf8.count <= 65_536,
              let data = value.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data)) != nil else {
            throw StoreError.invalidValue
        }
    }

    private static func isValidKey(_ key: String) -> Bool {
        let range = NSRange(key.startIndex..<key.endIndex, in: key)
        return keyPattern.firstMatch(in: key, range: range) != nil
    }

    private enum StoreError: Error {
        case invalidKey
        case invalidPrefix
        case invalidValue
        case keychain
    }
}
