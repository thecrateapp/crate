package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;

final class PcmBusEqualizer {
    static final int[] BANDS_HZ = { 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
    static final double Q = 1.41;
    static final float MAX_GAIN_DB = 12.0f;

    private static final class Request {
        final float[] gainsDb;
        final int rampFrames;

        Request(float[] gainsDb, int rampFrames) {
            this.gainsDb = gainsDb;
            this.rampFrames = rampFrames;
        }
    }

    private final int sampleRate;
    private final int channels;
    private final AtomicReference<Request> pending = new AtomicReference<>();
    private final float[] currentDb = new float[BANDS_HZ.length];
    private final float[] targetDb = new float[BANDS_HZ.length];
    private final double[][] coefficients = new double[BANDS_HZ.length][];
    private final double[][] state;
    private int remainingRampFrames;

    PcmBusEqualizer(int sampleRate, int channels) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.state = new double[BANDS_HZ.length][channels * 2];
    }

    void setGains(@Nullable float[] gainsDb) {
        setGains(gainsDb, 0);
    }

    void setGains(@Nullable float[] gainsDb, int rampFrames) {
        float[] targets = new float[BANDS_HZ.length];
        for (int band = 0; band < BANDS_HZ.length; band++) {
            float gainDb = gainsDb != null && band < gainsDb.length ? gainsDb[band] : 0.0f;
            targets[band] = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
        }
        pending.set(new Request(targets, Math.max(0, rampFrames)));
    }

    boolean isActive() {
        for (double[] band : coefficients) {
            if (band != null) return true;
        }
        return false;
    }

    void process(float[] samples, int frames) {
        applyPendingRequest();
        advanceRamp(frames);
        for (int band = 0; band < coefficients.length; band++) {
            double[] c = coefficients[band];
            if (c == null) continue;
            double[] z = state[band];
            for (int frame = 0; frame < frames; frame++) {
                for (int channel = 0; channel < channels; channel++) {
                    int index = frame * channels + channel;
                    int slot = channel * 2;
                    double input = samples[index];
                    double output = c[0] * input + z[slot];
                    z[slot] = c[1] * input - c[3] * output + z[slot + 1];
                    z[slot + 1] = c[2] * input - c[4] * output;
                    samples[index] = (float) output;
                }
            }
        }
    }

    private void applyPendingRequest() {
        Request request = pending.getAndSet(null);
        if (request == null) return;
        System.arraycopy(request.gainsDb, 0, targetDb, 0, targetDb.length);
        remainingRampFrames = request.rampFrames;
        if (remainingRampFrames == 0) {
            System.arraycopy(targetDb, 0, currentDb, 0, currentDb.length);
            for (int band = 0; band < BANDS_HZ.length; band++) updateBand(band);
        }
    }

    private void advanceRamp(int frames) {
        if (remainingRampFrames <= 0) return;
        float fraction = Math.min(1.0f, frames / (float) remainingRampFrames);
        remainingRampFrames = Math.max(0, remainingRampFrames - frames);
        for (int band = 0; band < BANDS_HZ.length; band++) {
            if (currentDb[band] == targetDb[band]) continue;
            currentDb[band] = remainingRampFrames == 0
                ? targetDb[band]
                : currentDb[band] + (targetDb[band] - currentDb[band]) * fraction;
            updateBand(band);
        }
    }

    private void updateBand(int band) {
        if (currentDb[band] == 0.0f) {
            coefficients[band] = null;
            Arrays.fill(state[band], 0.0);
            return;
        }
        coefficients[band] = peaking(BANDS_HZ[band], currentDb[band]);
    }

    private double[] peaking(int frequencyHz, float gainDb) {
        double amplitude = Math.pow(10.0, gainDb / 40.0);
        double omega = 2.0 * Math.PI * frequencyHz / sampleRate;
        double alpha = Math.sin(omega) / (2.0 * Q);
        double cosine = Math.cos(omega);
        double a0 = 1.0 + alpha / amplitude;
        return new double[] {
            (1.0 + alpha * amplitude) / a0,
            (-2.0 * cosine) / a0,
            (1.0 - alpha * amplitude) / a0,
            (-2.0 * cosine) / a0,
            (1.0 - alpha / amplitude) / a0,
        };
    }
}
