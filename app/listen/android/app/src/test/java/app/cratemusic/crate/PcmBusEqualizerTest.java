package app.cratemusic.crate;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PcmBusEqualizerTest {
    private static final int RATE = 48_000;

    private static float[] sine(double frequencyHz, int frames) {
        float[] samples = new float[frames * 2];
        for (int frame = 0; frame < frames; frame++) {
            float value = (float) (0.1 * Math.sin(2.0 * Math.PI * frequencyHz * frame / RATE));
            samples[frame * 2] = value;
            samples[frame * 2 + 1] = value;
        }
        return samples;
    }

    private static double tailGainDb(float[] before, float[] after) {
        double input = 0.0;
        double output = 0.0;
        for (int index = before.length / 2; index < before.length; index++) {
            input += before[index] * before[index];
            output += after[index] * after[index];
        }
        return 10.0 * Math.log10(output / input);
    }

    private static float[] gains(int band, float gainDb) {
        float[] gains = new float[PcmBusEqualizer.BANDS_HZ.length];
        gains[band] = gainDb;
        return gains;
    }

    @Test
    public void aFlatEqualizerLeavesTheMixUntouched() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(new float[PcmBusEqualizer.BANDS_HZ.length]);
        float[] samples = sine(1_000, 480);
        float[] original = samples.clone();

        equalizer.process(samples, 480);

        assertFalse(equalizer.isActive());
        assertArrayEquals(original, samples, 0.0f);
    }

    @Test
    public void aBandBoostsItsCenterFrequency() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(5, 6.0f));
        float[] samples = sine(1_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(6.0, tailGainDb(original, samples), 0.1);
    }

    @Test
    public void aLowBandLeavesTheMidrangeAlone() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(0, 12.0f));
        float[] samples = sine(2_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(0.0, tailGainDb(original, samples), 0.2);
    }

    @Test
    public void gainsAreClampedToTwelveDecibels() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(5, 30.0f));
        float[] samples = sine(1_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(12.0, tailGainDb(original, samples), 0.1);
    }

    private static double blockGainDb(PcmBusEqualizer equalizer, float[] signal, int block) {
        float[] chunk = java.util.Arrays.copyOfRange(signal, block * 960, (block + 1) * 960);
        float[] original = chunk.clone();
        equalizer.process(chunk, 480);
        double input = 0.0;
        double output = 0.0;
        for (int index = 0; index < chunk.length; index++) {
            input += original[index] * original[index];
            output += chunk[index] * chunk[index];
        }
        return 10.0 * Math.log10(output / input);
    }

    @Test
    public void aRampedChangeReachesItsGainGradually() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        float[] signal = sine(1_000, 480 * 40);
        for (int block = 0; block < 20; block++) blockGainDb(equalizer, signal, block);

        equalizer.setGains(gains(5, 12.0f), 3_840);
        double first = blockGainDb(equalizer, signal, 20);
        for (int block = 21; block < 30; block++) blockGainDb(equalizer, signal, block);
        double settled = blockGainDb(equalizer, signal, 30);

        assertTrue(first > 0.5 && first < 6.0);
        assertEquals(12.0, settled, 0.3);
    }

    @Test
    public void rampingBackToFlatBypassesTheFilters() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(5, 6.0f));
        float[] samples = sine(1_000, 480);
        equalizer.process(samples, 480);

        equalizer.setGains(null, 960);
        equalizer.process(sine(1_000, 480), 480);
        assertTrue(equalizer.isActive());
        equalizer.process(sine(1_000, 480), 480);

        assertFalse(equalizer.isActive());
    }
}
