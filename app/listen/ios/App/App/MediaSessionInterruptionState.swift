struct CrateMediaSessionInterruptionState {
    private var resumeRequested = false

    mutating func begin(wasPlaying: Bool) {
        resumeRequested = wasPlaying
    }

    mutating func stop() {
        resumeRequested = false
    }

    mutating func end(systemAllowsResume: Bool) -> Bool {
        let shouldResume = resumeRequested && systemAllowsResume
        resumeRequested = false
        return shouldResume
    }
}
