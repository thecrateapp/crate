import Foundation

enum OfflineAssetIntegrity {
    /// A 0-byte file is never a valid asset, even when we have no expected
    /// size to compare against — it means a download that started and
    /// produced an empty file, not one that legitimately has no content.
    static func isValid(size: Int64, expected: Int64) -> Bool {
        size > 0 && (expected <= 0 || size == expected)
    }

    static func excludeFromBackup(url: URL) throws {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableUrl = url
        try mutableUrl.setResourceValues(values)
    }
}
