package app.cratemusic.crate;

import java.util.Arrays;

final class BassHandoffFilter {
    static final double SHELF_HZ = 150.0;
    static final float CUT_DB = -24.0f;
    static final float SWAP_FRACTION = 0.125f;
    static final int RELEASE_MS = 100;
    static final int TAIL_MS = 50;

    private final double[] coefficients = new double[5];
    private double[] state = new double[0];
    private int sampleRate;
    private int channels;
    private int updateFrames;
    private float appliedCutDb;
    private boolean filtering;
    private double inputEnergy;
    private double outputEnergy;
    private long filteredFrames;
    private float deepestCutDb;
    private float releaseFromDb;
    private int releaseTotalFrames;
    private int releaseRemainingFrames;
    private int tailRemainingFrames;

    void configure(int sampleRate, int channels) {
        this.sampleRate = Math.max(1, sampleRate);
        this.channels = Math.max(1, channels);
        this.updateFrames = Math.max(1, this.sampleRate / 100);
        if (state.length != this.channels * 2) state = new double[this.channels * 2];
        reset();
    }

    void reset() {
        Arrays.fill(state, 0.0);
        appliedCutDb = 0.0f;
        filtering = false;
        inputEnergy = 0.0;
        outputEnergy = 0.0;
        filteredFrames = 0L;
        deepestCutDb = 0.0f;
        releaseRemainingFrames = 0;
        tailRemainingFrames = 0;
    }

    void release() {
        if (!filtering) {
            reset();
            return;
        }
        releaseFromDb = appliedCutDb;
        releaseTotalFrames = Math.max(1, sampleRate * RELEASE_MS / 1_000);
        releaseRemainingFrames = releaseTotalFrames;
    }

    boolean isReleasing() {
        return releaseRemainingFrames > 0 || filtering;
    }

    void processRelease(short[] samples, int frames) {
        int step = Math.max(1, sampleRate / 1_000);
        for (int first = 0; first < frames && filtering; first += step) {
            int count = Math.min(step, frames - first);
            if (releaseRemainingFrames > 0) {
                releaseRemainingFrames = Math.max(0, releaseRemainingFrames - count);
                updateCut(releaseFromDb * releaseRemainingFrames / (float) releaseTotalFrames);
            }
            filterSpan(samples, first, count);
        }
        if (!filtering) reset();
    }

    String summary() {
        double removedDb = inputEnergy > 0.0
            ? 10.0 * Math.log10(Math.max(outputEnergy, 1e-12) / inputEnergy)
            : 0.0;
        return "bassCutDb=" + deepestCutDb
            + " bassFilteredMs=" + filteredFrames * 1_000L / Math.max(1, sampleRate)
            + " bassEnergyDeltaDb=" + Math.round(removedDb * 10.0) / 10.0;
    }

    static float cutDb(NativeMixAudioProcessor.Role role, float progress, float handoffAt) {
        float center = Math.max(SWAP_FRACTION / 2.0f, Math.min(1.0f - SWAP_FRACTION / 2.0f, handoffAt));
        float position = (progress - (center - SWAP_FRACTION / 2.0f)) / SWAP_FRACTION;
        float swapped = position <= 0.0f
            ? 0.0f
            : position >= 1.0f ? 1.0f : (float) (0.5 - 0.5 * Math.cos(Math.PI * position));
        return role == NativeMixAudioProcessor.Role.INCOMING
            ? CUT_DB * (1.0f - swapped)
            : CUT_DB * swapped;
    }

    void process(
        short[] samples,
        int frames,
        long startFrame,
        long totalFrames,
        NativeMixAudioProcessor.Role role,
        float handoffAt
    ) {
        for (int first = 0; first < frames; first += updateFrames) {
            int count = Math.min(updateFrames, frames - first);
            float progress = Math.min(1.0f, (startFrame + first) / (float) Math.max(1L, totalFrames));
            updateCut(cutDb(role, progress, handoffAt));
            if (!filtering) continue;
            filterSpan(samples, first, count);
        }
    }

    private void updateCut(float cutDb) {
        if (cutDb == appliedCutDb && (filtering || cutDb == 0.0f)) return;
        boolean wasCutting = appliedCutDb != 0.0f;
        appliedCutDb = cutDb;
        if (cutDb == 0.0f) {
            if (!wasCutting) return;
            tailRemainingFrames = Math.max(1, sampleRate * TAIL_MS / 1_000);
        } else {
            tailRemainingFrames = 0;
        }
        filtering = true;
        deepestCutDb = Math.min(deepestCutDb, cutDb);
        double amplitude = Math.pow(10.0, cutDb / 40.0);
        double omega = 2.0 * Math.PI * SHELF_HZ / sampleRate;
        double cosine = Math.cos(omega);
        double alpha = Math.sin(omega) / 2.0 * Math.sqrt(2.0);
        double root = 2.0 * Math.sqrt(amplitude) * alpha;
        double a0 = (amplitude + 1.0) + (amplitude - 1.0) * cosine + root;
        coefficients[0] = amplitude * ((amplitude + 1.0) - (amplitude - 1.0) * cosine + root) / a0;
        coefficients[1] = 2.0 * amplitude * ((amplitude - 1.0) - (amplitude + 1.0) * cosine) / a0;
        coefficients[2] = amplitude * ((amplitude + 1.0) - (amplitude - 1.0) * cosine - root) / a0;
        coefficients[3] = -2.0 * ((amplitude - 1.0) + (amplitude + 1.0) * cosine) / a0;
        coefficients[4] = ((amplitude + 1.0) + (amplitude - 1.0) * cosine - root) / a0;
    }

    private void filterSpan(short[] samples, int firstFrame, int frames) {
        double b0 = coefficients[0];
        double b1 = coefficients[1];
        double b2 = coefficients[2];
        double a1 = coefficients[3];
        double a2 = coefficients[4];
        if (appliedCutDb != 0.0f) filteredFrames += frames;
        for (int frame = firstFrame; frame < firstFrame + frames; frame++) {
            for (int channel = 0; channel < channels; channel++) {
                int index = frame * channels + channel;
                int slot = channel * 2;
                double input = samples[index];
                double output = b0 * input + state[slot];
                state[slot] = b1 * input - a1 * output + state[slot + 1];
                state[slot + 1] = b2 * input - a2 * output;
                inputEnergy += input * input;
                outputEnergy += output * output;
                long rounded = Math.round(output);
                samples[index] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, rounded));
            }
        }
        if (appliedCutDb == 0.0f) {
            tailRemainingFrames -= frames;
            if (tailRemainingFrames <= 0) {
                filtering = false;
                Arrays.fill(state, 0.0);
            }
        }
    }
}
