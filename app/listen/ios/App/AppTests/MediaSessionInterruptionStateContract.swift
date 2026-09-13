@main
enum MediaSessionInterruptionStateContract {
    static func main() {
        var interruptedPlayback = CrateMediaSessionInterruptionState()
        interruptedPlayback.begin(wasPlaying: true)
        guard interruptedPlayback.end(systemAllowsResume: true) else {
            fatalError("Playback interrupted while active should resume")
        }
        guard !interruptedPlayback.end(systemAllowsResume: true) else {
            fatalError("A consumed resume intent must not be reused")
        }

        var stoppedPlayback = CrateMediaSessionInterruptionState()
        stoppedPlayback.begin(wasPlaying: true)
        stoppedPlayback.stop()
        guard !stoppedPlayback.end(systemAllowsResume: true) else {
            fatalError("Explicit stop during interruption must cancel resume")
        }

        var pausedPlayback = CrateMediaSessionInterruptionState()
        pausedPlayback.begin(wasPlaying: false)
        guard !pausedPlayback.end(systemAllowsResume: true) else {
            fatalError("Playback paused before interruption must stay paused")
        }

        var deniedResume = CrateMediaSessionInterruptionState()
        deniedResume.begin(wasPlaying: true)
        guard !deniedResume.end(systemAllowsResume: false) else {
            fatalError("The system resume policy must remain authoritative")
        }

        var explicitlyPaused = CrateMediaSessionInterruptionState()
        explicitlyPaused.begin(wasPlaying: true)
        explicitlyPaused.pause()
        guard !explicitlyPaused.end(systemAllowsResume: true) else {
            fatalError("Explicit pause during interruption must cancel resume")
        }

        var activation = CrateMediaSessionActivationState()
        guard activation.activate(), !activation.activate() else {
            fatalError("Audio activation must be idempotent")
        }
        activation.interrupted()
        guard activation.activate() else {
            fatalError("An interrupted audio session must be re-activatable")
        }
        guard activation.deactivate(), !activation.deactivate() else {
            fatalError("Audio deactivation must be idempotent")
        }
    }
}
