import Capacitor
import Foundation

@objc(CrateSecureSessionPlugin)
class CrateSecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateSecureSessionPlugin"
    let jsName = "CrateSecureSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPrefix", returnType: CAPPluginReturnPromise)
    ]

    private let store = CrateSecureSessionStore()

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Invalid secure session key")
            return
        }
        do {
            call.resolve(["value": try store.get(key: key) ?? NSNull()])
        } catch {
            call.reject("Secure session storage is unavailable")
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"),
              let value = call.getString("value") else {
            call.reject("Invalid secure session entry")
            return
        }
        do {
            try store.set(key: key, value: value)
            call.resolve()
        } catch {
            call.reject("Secure session storage is unavailable")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Invalid secure session key")
            return
        }
        do {
            try store.remove(key: key)
            call.resolve()
        } catch {
            call.reject("Secure session storage is unavailable")
        }
    }

    @objc func listKeys(_ call: CAPPluginCall) {
        guard let prefix = call.getString("prefix") else {
            call.reject("Invalid secure session prefix")
            return
        }
        do {
            call.resolve(["keys": try store.listKeys(prefix: prefix)])
        } catch {
            call.reject("Secure session storage is unavailable")
        }
    }

    @objc func clearPrefix(_ call: CAPPluginCall) {
        guard let prefix = call.getString("prefix") else {
            call.reject("Invalid secure session prefix")
            return
        }
        do {
            call.resolve(["removed": try store.clearPrefix(prefix)])
        } catch {
            call.reject("Secure session storage is unavailable")
        }
    }
}
