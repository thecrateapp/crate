import Capacitor
import Foundation

@objc(CrateOfflineIntegrityPlugin)
class CrateOfflineIntegrityPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateOfflineIntegrityPlugin"
    let jsName = "CrateOfflineIntegrity"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "verifyAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "excludeFromBackup", returnType: CAPPluginReturnPromise)
    ]

    @objc func excludeFromBackup(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("Offline asset path is invalid")
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let fileManager = FileManager.default
            let root = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .standardizedFileURL
            let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
            let url = root.appendingPathComponent(path).standardizedFileURL
            guard url.path.hasPrefix(rootPath), fileManager.fileExists(atPath: url.path) else {
                call.reject("Offline asset does not exist")
                return
            }
            do {
                try OfflineAssetIntegrity.excludeFromBackup(url: url)
                call.resolve(["excluded": true])
            } catch {
                call.reject("Could not exclude offline asset from backup", nil, error)
            }
        }
    }

    @objc func verifyAssets(_ call: CAPPluginCall) {
        guard let assets = call.getArray("assets"), assets.count <= 500 else {
            call.reject("Offline integrity batch is invalid")
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let fileManager = FileManager.default
            let root = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .standardizedFileURL
            let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
            let results: [[String: Any]] = assets.map { raw in
                guard let input = raw as? [String: Any],
                      let path = input["path"] as? String,
                      !path.isEmpty else {
                    return ["path": "", "exists": false, "size": 0, "valid": false]
                }
                let url = root.appendingPathComponent(path).standardizedFileURL
                guard url.path.hasPrefix(rootPath),
                      let attributes = try? fileManager.attributesOfItem(atPath: url.path),
                      let fileType = attributes[.type] as? FileAttributeType,
                      fileType == .typeRegular else {
                    return ["path": path, "exists": false, "size": 0, "valid": false]
                }
                let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
                let expected = (input["expectedBytes"] as? NSNumber)?.int64Value ?? 0
                let valid = OfflineAssetIntegrity.isValid(size: size, expected: expected)
                if !valid {
                    try? fileManager.removeItem(at: url)
                }
                return [
                    "path": path,
                    "exists": true,
                    "size": size,
                    "valid": valid
                ]
            }
            call.resolve(["assets": results])
        }
    }
}
