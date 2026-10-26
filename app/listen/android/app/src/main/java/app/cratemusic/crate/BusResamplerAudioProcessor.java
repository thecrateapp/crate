package app.cratemusic.crate;

import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;

@UnstableApi
final class BusResamplerAudioProcessor implements AudioProcessor {
    private final SonicAudioProcessor sonic = new SonicAudioProcessor();
    private final int outputSampleRateHz;

    BusResamplerAudioProcessor(int outputSampleRateHz) {
        this.outputSampleRateHz = outputSampleRateHz;
        sonic.setOutputSampleRateHz(outputSampleRateHz);
    }

    @Override
    public long getDurationAfterProcessorApplied(long durationUs) {
        return sonic.getDurationAfterProcessorApplied(durationUs);
    }

    @Override
    public AudioFormat configure(AudioFormat inputAudioFormat)
        throws UnhandledAudioFormatException {
        sonic.setOutputSampleRateHz(outputSampleRateHz);
        return sonic.configure(inputAudioFormat);
    }

    @Override
    public boolean isActive() {
        return sonic.isActive();
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        sonic.queueInput(inputBuffer);
    }

    @Override
    public void queueEndOfStream() {
        sonic.queueEndOfStream();
    }

    @Override
    public ByteBuffer getOutput() {
        return sonic.getOutput();
    }

    @Override
    public boolean isEnded() {
        return sonic.isEnded();
    }

    @Override
    public void flush(StreamMetadata streamMetadata) {
        sonic.flush(streamMetadata);
    }

    @Override
    public void reset() {
        sonic.reset();
        sonic.setOutputSampleRateHz(outputSampleRateHz);
    }
}
