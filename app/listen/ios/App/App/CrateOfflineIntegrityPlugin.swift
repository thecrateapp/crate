import Capacitor
import Foundation

@objc(CrateOfflineIntegrityPlugin)
class CrateOfflineIntegrityPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateOfflineIntegrityPlugin"
    let jsName = "CrateOfflineIntegrity"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "verifyAssets", returnType: CAPPluginReturnPromise)
    ]

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
                let valid = expected <= 0 || size == 0 || size == expected
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
