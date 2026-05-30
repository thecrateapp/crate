import Capacitor

class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CrateMediaSessionPlugin())
        bridge?.registerPluginInstance(CrateCastPlugin())
    }
}
