package app.cratemusic.crate;

import androidx.annotation.Nullable;

final class PcmBusEqualizer {
    static final int[] BANDS_HZ = { 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
    static final double Q = 1.41;
    static final float MAX_GAIN_DB = 12.0f;

    private final int sampleRate;
    private final int channels;
    private final double[][] state;
    @Nullable
    private volatile double[][] coefficients;

    PcmBusEqualizer(int sampleRate, int channels) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.state = new double[BANDS_HZ.length][channels * 2];
    }

    void setGains(@Nullable float[] gainsDb) {
        double[][] next = new double[BANDS_HZ.length][];
        boolean active = false;
        for (int band = 0; band < BANDS_HZ.length; band++) {
            float gainDb = gainsDb != null && band < gainsDb.length ? gainsDb[band] : 0.0f;
            gainDb = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
            if (gainDb == 0.0f) continue;
            next[band] = peaking(BANDS_HZ[band], gainDb);
            active = true;
        }
        coefficients = active ? next : null;
    }

    boolean isActive() {
        return coefficients != null;
    }

    void process(float[] samples, int frames) {
        double[][] bands = coefficients;
        if (bands == null) return;
        for (int band = 0; band < bands.length; band++) {
            double[] c = bands[band];
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
