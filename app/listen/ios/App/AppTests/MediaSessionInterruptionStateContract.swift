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
    }
}
