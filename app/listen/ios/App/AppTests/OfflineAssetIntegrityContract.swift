import Foundation

@main
enum OfflineAssetIntegrityContract {
    static func main() {
        guard OfflineAssetIntegrity.isValid(size: 3, expected: 3) else {
            fatalError("Expected a byte-for-byte size match to be valid")
        }
        guard OfflineAssetIntegrity.isValid(size: 5, expected: 0) else {
            fatalError(
                "A non-empty file with no expected size on record should be valid"
            )
        }
        guard !OfflineAssetIntegrity.isValid(size: 0, expected: 3) else {
            fatalError(
                "A 0-byte file must never be valid when we know the expected size"
            )
        }
        guard !OfflineAssetIntegrity.isValid(size: 0, expected: 0) else {
            fatalError(
                "A 0-byte file must never be valid even with no expected size on record"
            )
        }
        guard !OfflineAssetIntegrity.isValid(size: 4, expected: 3) else {
            fatalError("A size mismatch against a known expected size must be invalid")
        }
    }
}
