package app.cratemusic.crate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class NativeMixController {
    static final long STALL_TIMEOUT_MS = 3_000L;

    interface Listener {
        void onHandoff(long executionId, int newIndex, NativePlaybackDeck activeDeck);

        void onCompleted(long executionId, int finalIndex);

        void onCancelled(long executionId, String reason, boolean afterHandoff);

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
    private long standbyPreparedCueMs;
    private long executionId;
    private float observedProgress = -1.0f;
    private long observedProgressAtMs;
    private float outputVolume = 1.0f;
    private float duckMultiplier = 1.0f;

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
        setQueue(tracks, requestedIndex, 0L, autoplay);
    }

    void setQueue(
        List<NativeTrack> tracks,
        int requestedIndex,
        long startPositionMs,
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

        activeDeck.prepare(
            queue.get(logicalIndex),
            Math.max(0L, startPositionMs)
        );
        activeDeck.setVolume(effectiveOutputVolume());
        if (autoplay) {
            activeDeck.play();
        } else {
            activeDeck.pause();
        }
        prepareStandby();
    }

    void updateQueue(List<NativeTrack> tracks, String currentTrackId) {
        if (activePlan != null && keepsMixedEdge(tracks)) {
            queue.clear();
            queue.addAll(tracks);
            logicalIndex = indexOf(
                handoffComplete ? activePlan.incomingTrackId : activePlan.outgoingTrackId
            );
            return;
        }
        cancel("queue_updated");
        queue.clear();
        if (tracks != null) {
            queue.addAll(tracks);
        }
        standbyPreparationFailed = false;
        standbyDeck.releasePreparedSource();
        if (queue.isEmpty()) {
            activeDeck.releasePreparedSource();
            logicalIndex = 0;
            return;
        }

        int currentIndex = indexOf(currentTrackId);
        logicalIndex = currentIndex >= 0
            ? currentIndex
            : Math.max(0, Math.min(logicalIndex, queue.size() - 1));
        prepareStandby();
    }

    void onActiveTrackChanged(String currentTrackId) {
        if (activePlan != null) {
            return;
        }
        int currentIndex = indexOf(currentTrackId);
        if (currentIndex < 0 || currentIndex == logicalIndex) {
            return;
        }
        logicalIndex = currentIndex;
        standbyPreparationFailed = false;
        standbyDeck.releasePreparedSource();
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

    boolean isTransitionActive() {
        return activePlan != null;
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

        if (
            !standbyDeck.isReadyAt(
                incoming,
                plan.incomingCueMs,
                NativeMixTrigger.STANDBY_BUFFER_MARGIN_MS
            )
        ) {
            return false;
        }
        stateMachine.transitionTo(NativeTransitionState.PREPARING);
        stateMachine.transitionTo(NativeTransitionState.ARMED);

        executionId++;
        observedProgress = -1.0f;
        activePlan = plan;
        mixOutgoingDeck = activeDeck;
        mixIncomingDeck = standbyDeck;
        handoffComplete = false;
        mixOutgoingDeck.startEnvelope(
            NativeMixAudioProcessor.Role.OUTGOING,
            plan.durationMs,
            plan.outgoingGainDb
        );
        mixIncomingDeck.startEnvelope(
            NativeMixAudioProcessor.Role.INCOMING,
            plan.durationMs,
            plan.incomingGainDb
        );
        mixIncomingDeck.setVolume(effectiveOutputVolume());
        mixIncomingDeck.play();
        stateMachine.transitionTo(NativeTransitionState.MIXING);
        return true;
    }

    long executionId() {
        return executionId;
    }

    void observeProgress(long requestedExecutionId, float progress, long nowMs) {
        if (activePlan == null || requestedExecutionId != executionId) {
            return;
        }
        if (progress > observedProgress) {
            observedProgress = progress;
            observedProgressAtMs = nowMs;
        } else if (nowMs - observedProgressAtMs >= STALL_TIMEOUT_MS) {
            if (handoffComplete) {
                completeTransition();
            } else {
                cancel("transition_stalled");
            }
            return;
        }
        applyProgress(requestedExecutionId, progress);
    }

    void onDeckError(NativePlaybackDeck deck) {
        if (activePlan == null) {
            if (deck == standbyDeck) {
                standbyDeck.releasePreparedSource();
                standbyPreparationFailed = true;
                listener.onFailed("standby_deck_error");
            }
            return;
        }
        if (deck == mixOutgoingDeck) {
            completeTransition();
        } else if (deck == mixIncomingDeck) {
            if (!handoffComplete) {
                standbyPreparationFailed = true;
            }
            cancel(handoffComplete ? "active_deck_error" : "incoming_deck_error");
        }
    }

    void applyProgress(long requestedExecutionId, float requestedProgress) {
        if (
            activePlan == null ||
            requestedExecutionId != executionId ||
            stateMachine.state() == NativeTransitionState.IDLE
        ) {
            return;
        }
        float progress = Math.max(0.0f, Math.min(1.0f, requestedProgress));

        if (!handoffComplete && progress >= activePlan.handoffProgress) {
            handoff();
        }
        if (progress >= 1.0f) {
            completeTransition();
        }
    }

    float transitionProgress() {
        return mixIncomingDeck == null ? 0.0f : mixIncomingDeck.envelopeProgress();
    }

    void cancel(String reason) {
        NativeTransitionState state = stateMachine.state();
        if (state == NativeTransitionState.IDLE) {
            return;
        }
        boolean afterHandoff = handoffComplete;
        stateMachine.transitionTo(NativeTransitionState.CANCELLED);
        if (afterHandoff) {
            mixIncomingDeck.clearEnvelope();
            mixIncomingDeck.setVolume(effectiveOutputVolume());
            mixOutgoingDeck.stop();
            mixOutgoingDeck.releasePreparedSource();
        } else {
            mixOutgoingDeck.clearEnvelope();
            mixOutgoingDeck.setVolume(effectiveOutputVolume());
            mixIncomingDeck.stop();
            mixIncomingDeck.releasePreparedSource();
        }
        long cancelledExecutionId = executionId;
        resetTransition();
        stateMachine.transitionTo(NativeTransitionState.IDLE);
        listener.onCancelled(cancelledExecutionId, reason, afterHandoff);
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

    void prepareStandbyAt(long incomingCueMs) {
        if (activePlan != null || standbyPreparationFailed || !canMixNext()) {
            return;
        }
        NativeTrack incoming = queue.get(logicalIndex + 1);
        long cueMs = Math.max(0L, incomingCueMs);
        if (standbyDeck.isReadyFor(incoming) && standbyPreparedCueMs == cueMs) {
            return;
        }
        prepareStandby(cueMs);
    }

    boolean isStandbyReadyAt(long incomingCueMs, long minimumBufferedMs) {
        return (
            activePlan == null &&
            canMixNext() &&
            standbyDeck.isReadyAt(
                queue.get(logicalIndex + 1),
                incomingCueMs,
                minimumBufferedMs
            )
        );
    }

    boolean hasPreparedStandby() {
        return (
            canMixNext() &&
            standbyDeck.isReadyFor(queue.get(logicalIndex + 1))
        );
    }

    void setOutputVolume(float requestedVolume) {
        if (Float.isNaN(requestedVolume) || Float.isInfinite(requestedVolume)) {
            outputVolume = 1.0f;
        } else {
            outputVolume = Math.max(0.0f, Math.min(1.0f, requestedVolume));
        }
        if (activePlan == null) {
            activeDeck.setVolume(effectiveOutputVolume());
            return;
        }
        mixOutgoingDeck.setVolume(effectiveOutputVolume());
        mixIncomingDeck.setVolume(effectiveOutputVolume());
    }

    void setDuckMultiplier(float requestedMultiplier) {
        if (
            Float.isNaN(requestedMultiplier) ||
            Float.isInfinite(requestedMultiplier)
        ) {
            duckMultiplier = 1.0f;
        } else {
            duckMultiplier = Math.max(
                0.0f,
                Math.min(1.0f, requestedMultiplier)
            );
        }
        if (activePlan == null) {
            activeDeck.setVolume(effectiveOutputVolume());
            return;
        }
        mixOutgoingDeck.setVolume(effectiveOutputVolume());
        mixIncomingDeck.setVolume(effectiveOutputVolume());
    }

    private boolean prepareStandby() {
        if (!canMixNext()) {
            standbyDeck.releasePreparedSource();
            return false;
        }
        if (standbyPreparationFailed) {
            return false;
        }
        if (standbyDeck.isReadyFor(queue.get(logicalIndex + 1))) {
            return true;
        }
        return prepareStandby(0L);
    }

    private boolean prepareStandby(long cueMs) {
        NativeTrack incoming = queue.get(logicalIndex + 1);
        try {
            standbyDeck.prepare(incoming, cueMs);
            standbyPreparedCueMs = cueMs;
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

    private boolean keepsMixedEdge(List<NativeTrack> tracks) {
        if (tracks == null) {
            return false;
        }
        for (int index = 0; index + 1 < tracks.size(); index++) {
            if (
                tracks.get(index).id.equals(activePlan.outgoingTrackId) &&
                tracks.get(index + 1).id.equals(activePlan.incomingTrackId)
            ) {
                return true;
            }
        }
        return false;
    }

    private int indexOf(String trackId) {
        if (trackId == null || trackId.isEmpty()) {
            return -1;
        }
        for (int index = 0; index < queue.size(); index++) {
            if (queue.get(index).id.equals(trackId)) {
                return index;
            }
        }
        return -1;
    }

    private void handoff() {
        stateMachine.transitionTo(NativeTransitionState.HANDED_OFF);
        handoffComplete = true;
        logicalIndex++;
        activeDeck = mixIncomingDeck;
        standbyDeck = mixOutgoingDeck;
        listener.onHandoff(executionId, logicalIndex, activeDeck);
    }

    private void completeTransition() {
        if (!handoffComplete) {
            handoff();
        }
        stateMachine.transitionTo(NativeTransitionState.COMPLETING);
        mixOutgoingDeck.stop();
        mixOutgoingDeck.releasePreparedSource();
        mixIncomingDeck.setVolume(effectiveOutputVolume());
        mixIncomingDeck.clearEnvelope();
        resetTransition();
        stateMachine.transitionTo(NativeTransitionState.IDLE);
        listener.onCompleted(executionId, logicalIndex);
        prepareStandby();
    }

    private void resetTransition() {
        activePlan = null;
        mixOutgoingDeck = null;
        mixIncomingDeck = null;
        handoffComplete = false;
    }

    private float effectiveOutputVolume() {
        return outputVolume * duckMultiplier;
    }
}
