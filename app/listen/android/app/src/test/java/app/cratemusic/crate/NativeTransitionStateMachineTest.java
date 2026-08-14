package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class NativeTransitionStateMachineTest {

    @Test
    public void acceptsTheCompleteTransitionLifecycle() {
        NativeTransitionStateMachine machine =
            new NativeTransitionStateMachine();

        machine.transitionTo(NativeTransitionState.PREPARING);
        machine.transitionTo(NativeTransitionState.ARMED);
        machine.transitionTo(NativeTransitionState.MIXING);
        machine.transitionTo(NativeTransitionState.HANDED_OFF);
        machine.transitionTo(NativeTransitionState.COMPLETING);
        machine.transitionTo(NativeTransitionState.IDLE);

        assertEquals(NativeTransitionState.IDLE, machine.state());
    }

    @Test
    public void supportsCancellationAndFailureRecovery() {
        NativeTransitionStateMachine cancelled =
            new NativeTransitionStateMachine();
        cancelled.transitionTo(NativeTransitionState.PREPARING);
        cancelled.transitionTo(NativeTransitionState.CANCELLED);
        cancelled.transitionTo(NativeTransitionState.IDLE);

        NativeTransitionStateMachine failed =
            new NativeTransitionStateMachine();
        failed.transitionTo(NativeTransitionState.PREPARING);
        failed.transitionTo(NativeTransitionState.FAILED);
        failed.transitionTo(NativeTransitionState.IDLE);

        assertEquals(NativeTransitionState.IDLE, cancelled.state());
        assertEquals(NativeTransitionState.IDLE, failed.state());
    }

    @Test
    public void rejectsIllegalTransitions() {
        NativeTransitionStateMachine machine =
            new NativeTransitionStateMachine();

        assertThrows(
            IllegalStateException.class,
            () -> machine.transitionTo(NativeTransitionState.MIXING)
        );

        machine.transitionTo(NativeTransitionState.PREPARING);
        assertThrows(
            IllegalStateException.class,
            () -> machine.transitionTo(NativeTransitionState.HANDED_OFF)
        );
    }
}
