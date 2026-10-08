package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeMixSignalTest {
    @Test
    public void equalPowerEnvelopeHasContinuousBoundedEndpoints() {
        float previousOutgoing = 1.0f;
        float previousIncoming = 0.0f;

        for (int step = 0; step <= 100; step++) {
            float progress = step / 100.0f;
            float outgoing =
                NativeMixAudioProcessor.equalPowerOutgoing(progress);
            float incoming =
                NativeMixAudioProcessor.equalPowerIncoming(progress);

            assertTrue(Float.isFinite(outgoing));
            assertTrue(Float.isFinite(incoming));
            assertTrue(outgoing >= 0.0f && outgoing <= 1.0f);
            assertTrue(incoming >= 0.0f && incoming <= 1.0f);
            assertTrue(Math.abs(outgoing - previousOutgoing) < 0.02f);
            assertTrue(Math.abs(incoming - previousIncoming) < 0.02f);
            previousOutgoing = outgoing;
            previousIncoming = incoming;
        }

        assertEquals(
            (float) Math.sqrt(0.5),
            NativeMixAudioProcessor.equalPowerOutgoing(0.5f),
            0.0001f
        );
        assertEquals(
            (float) Math.sqrt(0.5),
            NativeMixAudioProcessor.equalPowerIncoming(0.5f),
            0.0001f
        );
    }
}
