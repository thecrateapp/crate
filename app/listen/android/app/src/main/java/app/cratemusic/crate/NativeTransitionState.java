package app.cratemusic.crate;

enum NativeTransitionState {
    IDLE,
    PREPARING,
    ARMED,
    MIXING,
    HANDED_OFF,
    COMPLETING,
    CANCELLED,
    FAILED
}
