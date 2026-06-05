import Capacitor
import UIKit

@objc(CrateSocialSharePlugin)
class CrateSocialSharePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateSocialSharePlugin"
    let jsName = "CrateSocialShare"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "canShareInstagramStory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareInstagramStory", returnType: CAPPluginReturnPromise)
    ]

    @objc func canShareInstagramStory(_ call: CAPPluginCall) {
        call.resolve(["available": canOpenInstagramStories()])
    }

    @objc func shareInstagramStory(_ call: CAPPluginCall) {
        guard canOpenInstagramStories() else {
            call.reject("Instagram is not installed")
            return
        }
        guard let imageDataUrl = call.getString("imageDataUrl"),
              let imageData = decodeDataUrl(imageDataUrl) else {
            call.reject("Missing story image")
            return
        }

        var pasteboardItem: [String: Any] = [
            "com.instagram.sharedSticker.backgroundImage": imageData
        ]
        if let contentUrl = call.getString("contentUrl"), !contentUrl.isEmpty {
            pasteboardItem["com.instagram.sharedSticker.contentURL"] = contentUrl
        }

        let pasteboardOptions: [UIPasteboard.OptionsKey: Any] = [
            .expirationDate: Date().addingTimeInterval(60 * 5)
        ]
        UIPasteboard.general.setItems([pasteboardItem], options: pasteboardOptions)

        DispatchQueue.main.async {
            guard let url = URL(string: "instagram-stories://share") else {
                call.reject("Invalid Instagram Stories URL")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["shared": true])
                } else {
                    call.reject("Failed to open Instagram Stories")
                }
            }
        }
    }

    private func canOpenInstagramStories() -> Bool {
        guard let url = URL(string: "instagram-stories://share") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    private func decodeDataUrl(_ dataUrl: String) -> Data? {
        let payload: String
        if let commaIndex = dataUrl.firstIndex(of: ",") {
            payload = String(dataUrl[dataUrl.index(after: commaIndex)...])
        } else {
            payload = dataUrl
        }
        return Data(base64Encoded: payload)
    }
}
