package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import app.cratemusic.crate.NativeMixAudioProcessor.Role;

import org.junit.Test;

public class BassHandoffFilterTest {
    private static short[] sine(double frequencyHz, int sampleRate, int frames, int channels, double amplitude) {
        short[] samples = new short[frames * channels];
        for (int frame = 0; frame < frames; frame++) {
            short value = (short) Math.round(amplitude * Math.sin(2.0 * Math.PI * frequencyHz * frame / sampleRate));
            for (int channel = 0; channel < channels; channel++) samples[frame * channels + channel] = value;
        }
        return samples;
    }

    private static double rmsDb(short[] samples, int from, int to) {
        double sum = 0.0;
        for (int index = from; index < to; index++) sum += samples[index] * (double) samples[index];
        return 10.0 * Math.log10(sum / Math.max(1, to - from));
    }

    private static double tailGainDb(double frequencyHz, int sampleRate, Role role) {
        BassHandoffFilter filter = new BassHandoffFilter();
        filter.configure(sampleRate, 2);
        int frames = sampleRate;
        short[] original = sine(frequencyHz, sampleRate, frames * 2, 2, 8_000);
        short[] filtered = original.clone();
        filter.process(filtered, frames * 2, 0L, Long.MAX_VALUE, role, 0.5f);
        return rmsDb(filtered, frames * 2, frames * 4) - rmsDb(original, frames * 2, frames * 4);
    }

    @Test
    public void theIncomingDeckGetsItsBassBackAtTheHandoff() {
        assertEquals(BassHandoffFilter.CUT_DB, BassHandoffFilter.cutDb(Role.INCOMING, 0.0f, 0.5f), 0.0f);
        assertEquals(BassHandoffFilter.CUT_DB / 2, BassHandoffFilter.cutDb(Role.INCOMING, 0.5f, 0.5f), 0.01f);
        assertEquals(0.0f, BassHandoffFilter.cutDb(Role.INCOMING, 0.6f, 0.5f), 0.0f);
        assertEquals(0.0f, BassHandoffFilter.cutDb(Role.OUTGOING, 0.4f, 0.5f), 0.0f);
        assertEquals(BassHandoffFilter.CUT_DB / 2, BassHandoffFilter.cutDb(Role.OUTGOING, 0.5f, 0.5f), 0.01f);
        assertEquals(BassHandoffFilter.CUT_DB, BassHandoffFilter.cutDb(Role.OUTGOING, 1.0f, 0.5f), 0.0f);
    }

    @Test
    public void bothDecksSwapAtTheSameMoment() {
        for (float progress = 0.0f; progress <= 1.0f; progress += 0.01f) {
            float incoming = BassHandoffFilter.cutDb(Role.INCOMING, progress, 0.5f);
            float outgoing = BassHandoffFilter.cutDb(Role.OUTGOING, progress, 0.5f);
            assertEquals(BassHandoffFilter.CUT_DB, incoming + outgoing, 0.01f);
        }
    }

    @Test
    public void aCutDeckLosesItsBassButKeepsItsMids() {
        assertEquals(-24.0, tailGainDb(40, 48_000, Role.INCOMING), 1.5);
        assertEquals(0.0, tailGainDb(2_000, 48_000, Role.INCOMING), 0.3);
    }

    @Test
    public void theFilterStaysStableAtEverySampleRate() {
        for (int sampleRate : new int[] { 44_100, 48_000, 96_000 }) {
            double gain = tailGainDb(40, sampleRate, Role.INCOMING);
            assertTrue("rate " + sampleRate + " gain " + gain, gain < -20.0 && gain > -26.0);
        }
    }

    @Test
    public void theSwapIsContinuous() {
        int sampleRate = 48_000;
        int frames = sampleRate * 2;
        short[] original = sine(60, sampleRate, frames, 1, 10_000);
        short[] filtered = original.clone();
        BassHandoffFilter filter = new BassHandoffFilter();
        filter.configure(sampleRate, 1);

        for (int first = 0; first < frames; first += 480) {
            short[] block = java.util.Arrays.copyOfRange(filtered, first, first + 480);
            filter.process(block, 480, first, frames, Role.INCOMING, 0.5f);
            System.arraycopy(block, 0, filtered, first, 480);
        }

        int maxStep = 0;
        int originalStep = 0;
        for (int index = 1; index < frames; index++) {
            maxStep = Math.max(maxStep, Math.abs(filtered[index] - filtered[index - 1]));
            originalStep = Math.max(originalStep, Math.abs(original[index] - original[index - 1]));
        }
        assertTrue("step " + maxStep + " vs " + originalStep, maxStep <= originalStep * 1.2);
    }

    @Test
    public void correlatedBassNeverSumsAboveTheUnfilteredDecks() {
        int sampleRate = 48_000;
        int frames = sampleRate * 2;
        short[] outgoing = sine(60, sampleRate, frames, 1, 8_000);
        short[] incoming = outgoing.clone();
        BassHandoffFilter outgoingFilter = new BassHandoffFilter();
        BassHandoffFilter incomingFilter = new BassHandoffFilter();
        outgoingFilter.configure(sampleRate, 1);
        incomingFilter.configure(sampleRate, 1);

        for (int first = 0; first < frames; first += 480) {
            short[] out = java.util.Arrays.copyOfRange(outgoing, first, first + 480);
            short[] in = java.util.Arrays.copyOfRange(incoming, first, first + 480);
            outgoingFilter.process(out, 480, first, frames, Role.OUTGOING, 0.5f);
            incomingFilter.process(in, 480, first, frames, Role.INCOMING, 0.5f);
            System.arraycopy(out, 0, outgoing, first, 480);
            System.arraycopy(in, 0, incoming, first, 480);
        }

        for (int index = 0; index < frames; index++) {
            assertTrue(Math.abs(outgoing[index] + incoming[index]) <= 16_000 * 1.01);
        }
    }

    @Test
    public void theSummaryReportsHowMuchBassWasRemoved() {
        BassHandoffFilter filter = new BassHandoffFilter();
        filter.configure(48_000, 1);

        filter.process(sine(40, 48_000, 48_000, 1, 8_000), 48_000, 0L, Long.MAX_VALUE, Role.INCOMING, 0.5f);

        String summary = filter.summary();
        assertTrue(summary, summary.contains("bassCutDb=-24.0"));
        assertTrue(summary, summary.contains("bassFilteredMs=1000"));
        assertTrue(summary, summary.contains("bassEnergyDeltaDb=-2"));
    }

    @Test
    public void releasingMidSwapRampsTheBassBackWithoutAJump() {
        int sampleRate = 48_000;
        BassHandoffFilter filter = new BassHandoffFilter();
        filter.configure(sampleRate, 1);
        short[] signal = sine(60, sampleRate, sampleRate, 1, 10_000);
        short[] filtered = signal.clone();
        short[] head = java.util.Arrays.copyOfRange(filtered, 0, 24_000);
        filter.process(head, 24_000, 0L, Long.MAX_VALUE, Role.INCOMING, 0.5f);
        System.arraycopy(head, 0, filtered, 0, 24_000);

        filter.release();
        for (int first = 24_000; first < sampleRate; first += 480) {
            short[] block = java.util.Arrays.copyOfRange(filtered, first, first + 480);
            filter.processRelease(block, 480);
            System.arraycopy(block, 0, filtered, first, 480);
        }

        int maxStep = 0;
        int originalStep = 0;
        for (int index = 23_000; index < 30_000; index++) {
            maxStep = Math.max(maxStep, Math.abs(filtered[index] - filtered[index - 1]));
            originalStep = Math.max(originalStep, Math.abs(signal[index] - signal[index - 1]));
        }
        assertTrue("step " + maxStep + " vs " + originalStep, maxStep <= originalStep * 1.2);
        assertFalse(filter.isReleasing());
        assertEquals(signal[sampleRate - 1], filtered[sampleRate - 1]);
    }

    @Test
    public void resetForgetsThePreviousMix() {
        BassHandoffFilter filter = new BassHandoffFilter();
        filter.configure(48_000, 1);
        filter.process(sine(40, 48_000, 4_800, 1, 8_000), 4_800, 0L, 9_600L, Role.INCOMING, 0.5f);

        filter.reset();
        short[] silence = new short[480];
        filter.process(silence, 480, 9_600L, 9_600L, Role.INCOMING, 0.5f);

        for (short sample : silence) assertEquals(0, sample);
    }
}
