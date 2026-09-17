struct CrateMediaSessionInterruptionState {
    private var resumeRequested = false

    mutating func begin(wasPlaying: Bool) {
        resumeRequested = wasPlaying
    }

    mutating func stop() {
        resumeRequested = false
    }

    mutating func pause() {
        resumeRequested = false
    }

    mutating func end(systemAllowsResume: Bool) -> Bool {
        let shouldResume = resumeRequested && systemAllowsResume
        resumeRequested = false
        return shouldResume
    }
}

struct CrateMediaSessionActivationState {
    private(set) var isActive = false

    mutating func activate() -> Bool {
        guard !isActive else { return false }
        isActive = true
        return true
    }

    mutating func deactivate() -> Bool {
        guard isActive else { return false }
        isActive = false
        return true
    }

    mutating func interrupted() {
        isActive = false
    }
}
