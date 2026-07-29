package app.cratemusic.crate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class NativeMixController {
    interface Listener {
        void onHandoff(int newIndex, NativePlaybackDeck activeDeck);

        void onCancelled(String reason, boolean afterHandoff);

        void onFailed(String reason);
    }

    private final Listener listener;
    private final NativeTransitionStateMachine stateMachine =
        new NativeTransitionStateMachine();
    private final List<NativeTrack> queue = new ArrayList<>();

    private NativePlaybackDeck activeDeck;
    private NativePlaybackDeck standbyDeck;
    private NativePlaybackDeck mixOutgoingDeck;
    private NativePlaybackDeck mixIncomingDeck;
    private NativeTransitionPlan activePlan;
    private int logicalIndex;
    private boolean enabled;
    private boolean repeatOne;
    private boolean handoffComplete;
    private boolean standbyPreparationFailed;

    NativeMixController(
        NativePlaybackDeck deckA,
        NativePlaybackDeck deckB,
        Listener listener
    ) {
        if (deckA == null || deckB == null || deckA == deckB) {
            throw new IllegalArgumentException(
                "Native mix controller requires two distinct decks"
            );
        }
        this.activeDeck = deckA;
        this.standbyDeck = deckB;
        this.listener = listener;
    }

    void setQueue(
        List<NativeTrack> tracks,
        int requestedIndex,
        boolean autoplay
    ) {
        cancel("queue_replaced");
        queue.clear();
        if (tracks != null) {
            queue.addAll(tracks);
        }
        logicalIndex = queue.isEmpty()
            ? 0
            : Math.max(0, Math.min(requestedIndex, queue.size() - 1));
        standbyPreparationFailed = false;
        standbyDeck.releasePreparedSource();
        if (queue.isEmpty()) {
            activeDeck.releasePreparedSource();
            return;
        }

        activeDeck.prepare(queue.get(logicalIndex), 0L);
        activeDeck.setVolume(1.0f);
        if (autoplay) {
            activeDeck.play();
        } else {
            activeDeck.pause();
        }
        prepareStandby();
    }

    List<NativeTrack> queueSnapshot() {
        return Collections.unmodifiableList(new ArrayList<>(queue));
    }

    void setEnabled(boolean requestedEnabled) {
        enabled = requestedEnabled;
        standbyPreparationFailed = false;
        if (!enabled) {
            cancel("disabled");
            standbyDeck.releasePreparedSource();
            return;
        }
        prepareStandby();
    }

    boolean isEnabled() {
        return enabled;
    }

    void setRepeatOne(boolean requestedRepeatOne) {
        repeatOne = requestedRepeatOne;
        standbyPreparationFailed = false;
        if (repeatOne) {
            cancel("repeat_one");
            standbyDeck.releasePreparedSource();
            return;
        }
        prepareStandby();
    }

    boolean beginTransition(NativeTransitionPlan plan) {
        if (!canMixNext() || plan == null || standbyPreparationFailed) {
            activeDeck.play();
            return false;
        }

        NativeTrack outgoing = queue.get(logicalIndex);
        NativeTrack incoming = queue.get(logicalIndex + 1);
        if (
            !outgoing.id.equals(plan.outgoingTrackId) ||
            !incoming.id.equals(plan.incomingTrackId) ||
            plan.mode == NativeTransitionPlan.Mode.GAPLESS ||
            plan.durationMs <= 0L
        ) {
            return false;
        }

        stateMachine.transitionTo(NativeTransitionState.PREPARING);
        if (!standbyDeck.isReadyFor(incoming) && !prepareStandby()) {
            failTransition("standby_prepare_failed");
            return false;
        }
        stateMachine.transitionTo(NativeTransitionState.ARMED);

        activePlan = plan;
        mixOutgoingDeck = activeDeck;
        mixIncomingDeck = standbyDeck;
        handoffComplete = false;
        mixOutgoingDeck.setVolume(amplitude(plan.outgoingGainDb));
        mixIncomingDeck.setVolume(0.0f);
        mixIncomingDeck.seekTo(plan.incomingCueMs);
        mixIncomingDeck.play();
        stateMachine.transitionTo(NativeTransitionState.MIXING);
        return true;
    }

    void applyProgress(float requestedProgress) {
        if (
            activePlan == null ||
            stateMachine.state() == NativeTransitionState.IDLE
        ) {
            return;
        }
        float progress = Math.max(0.0f, Math.min(1.0f, requestedProgress));
        double phase = progress * Math.PI * 0.5;
        mixOutgoingDeck.setVolume(
            (float) Math.cos(phase) * amplitude(activePlan.outgoingGainDb)
        );
        mixIncomingDeck.setVolume(
            (float) Math.sin(phase) * amplitude(activePlan.incomingGainDb)
        );

        if (!handoffComplete && progress >= activePlan.handoffProgress) {
            handoff();
        }
        if (progress >= 1.0f) {
            completeTransition();
        }
    }

    void cancel(String reason) {
        NativeTransitionState state = stateMachine.state();
        if (state == NativeTransitionState.IDLE) {
            return;
        }
        boolean afterHandoff = handoffComplete;
        stateMachine.transitionTo(NativeTransitionState.CANCELLED);
        if (afterHandoff) {
            mixIncomingDeck.setVolume(1.0f);
            mixOutgoingDeck.stop();
            mixOutgoingDeck.releasePreparedSource();
        } else {
            mixOutgoingDeck.setVolume(1.0f);
            mixIncomingDeck.stop();
            mixIncomingDeck.releasePreparedSource();
        }
        resetTransition();
        stateMachine.transitionTo(NativeTransitionState.IDLE);
        listener.onCancelled(reason, afterHandoff);
        prepareStandby();
    }

    NativePlaybackDeck activeDeck() {
        return activeDeck;
    }

    NativePlaybackDeck standbyDeck() {
        return standbyDeck;
    }

    int logicalIndex() {
        return logicalIndex;
    }

    boolean hasPreparedStandby() {
        return (
            canMixNext() &&
            standbyDeck.isReadyFor(queue.get(logicalIndex + 1))
        );
    }

    private boolean prepareStandby() {
        if (!canMixNext()) {
            standbyDeck.releasePreparedSource();
            return false;
        }
        NativeTrack incoming = queue.get(logicalIndex + 1);
        if (standbyDeck.isReadyFor(incoming)) {
            return true;
        }
        try {
            standbyDeck.prepare(incoming, 0L);
            standbyDeck.setVolume(0.0f);
            standbyPreparationFailed = false;
            return true;
        } catch (RuntimeException error) {
            standbyDeck.releasePreparedSource();
            standbyPreparationFailed = true;
            listener.onFailed("standby_prepare_failed");
            return false;
        }
    }

    private boolean canMixNext() {
        return (
            enabled &&
            !repeatOne &&
            logicalIndex >= 0 &&
            logicalIndex + 1 < queue.size()
        );
    }

    private void handoff() {
        stateMachine.transitionTo(NativeTransitionState.HANDED_OFF);
        handoffComplete = true;
        logicalIndex++;
        activeDeck = mixIncomingDeck;
        standbyDeck = mixOutgoingDeck;
        listener.onHandoff(logicalIndex, activeDeck);
    }

    private void completeTransition() {
        if (!handoffComplete) {
            handoff();
        }
        stateMachine.transitionTo(NativeTransitionState.COMPLETING);
        mixOutgoingDeck.stop();
        mixOutgoingDeck.releasePreparedSource();
        mixIncomingDeck.setVolume(1.0f);
        resetTransition();
        stateMachine.transitionTo(NativeTransitionState.IDLE);
        prepareStandby();
    }

    private void failTransition(String reason) {
        stateMachine.transitionTo(NativeTransitionState.FAILED);
        activeDeck.setVolume(1.0f);
        activeDeck.play();
        standbyDeck.stop();
        standbyDeck.releasePreparedSource();
        resetTransition();
        stateMachine.transitionTo(NativeTransitionState.IDLE);
        listener.onFailed(reason);
    }

    private void resetTransition() {
        activePlan = null;
        mixOutgoingDeck = null;
        mixIncomingDeck = null;
        handoffComplete = false;
    }

    private static float amplitude(float gainDb) {
        return (float) Math.pow(10.0, gainDb / 20.0);
    }
}
