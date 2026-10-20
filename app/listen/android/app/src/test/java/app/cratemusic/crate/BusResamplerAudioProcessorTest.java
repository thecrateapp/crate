package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;

import org.junit.Test;

public class BusResamplerAudioProcessorTest {
    @Test
    public void keepsResamplingToTheBusRateAfterAReset() throws Exception {
        BusResamplerAudioProcessor resampler = new BusResamplerAudioProcessor(48_000);
        resampler.configure(new AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT));

        resampler.reset();
        AudioFormat output =
            resampler.configure(new AudioFormat(96_000, 2, C.ENCODING_PCM_16BIT));

        assertTrue(resampler.isActive());
        assertEquals(48_000, output.sampleRate);
    }
}
