package app.cratemusic.crate;

final class NativeTransitionStateMachine {
    private NativeTransitionState state = NativeTransitionState.IDLE;

    NativeTransitionState state() {
        return state;
    }

    void transitionTo(NativeTransitionState next) {
        if (!isAllowed(state, next)) {
            throw new IllegalStateException(
                "Illegal native transition state change: " +
                state +
                " -> " +
                next
            );
        }
        state = next;
    }

    private static boolean isAllowed(
        NativeTransitionState current,
        NativeTransitionState next
    ) {
        switch (current) {
            case IDLE:
                return next == NativeTransitionState.PREPARING;
            case PREPARING:
                return (
                    next == NativeTransitionState.ARMED ||
                    next == NativeTransitionState.CANCELLED ||
                    next == NativeTransitionState.FAILED
                );
            case ARMED:
                return (
                    next == NativeTransitionState.MIXING ||
                    next == NativeTransitionState.CANCELLED ||
                    next == NativeTransitionState.FAILED
                );
            case MIXING:
                return (
                    next == NativeTransitionState.HANDED_OFF ||
                    next == NativeTransitionState.CANCELLED ||
                    next == NativeTransitionState.FAILED
                );
            case HANDED_OFF:
                return (
                    next == NativeTransitionState.COMPLETING ||
                    next == NativeTransitionState.CANCELLED ||
                    next == NativeTransitionState.FAILED
                );
            case COMPLETING:
                return (
                    next == NativeTransitionState.IDLE ||
                    next == NativeTransitionState.FAILED
                );
            case CANCELLED:
            case FAILED:
                return next == NativeTransitionState.IDLE;
            default:
                return false;
        }
    }
}
