package app.cratemusic.crate;

import android.media.AudioDeviceInfo;

import androidx.media3.common.C;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.audio.AudioOutput;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@UnstableApi
final class PcmBusAudioOutput implements AudioOutput {
    private static final int SCRATCH_FRAMES = 4_096;

    private final PcmBusChannel channel;
    private final PcmBusMixer mixer;
    private final int encoding;
    private final int inputChannels;
    private final int sampleRate;
    private final int audioSessionId;
    private final float[] scratch = new float[SCRATCH_FRAMES * PcmBusMixer.CHANNELS];

    PcmBusAudioOutput(
        PcmBusChannel channel,
        PcmBusMixer mixer,
        int encoding,
        int inputChannels,
        int sampleRate,
        int audioSessionId
    ) {
        this.channel = channel;
        this.mixer = mixer;
        this.encoding = encoding;
        this.inputChannels = inputChannels;
        this.sampleRate = sampleRate;
        this.audioSessionId = audioSessionId;
    }

    @Override
    public boolean write(ByteBuffer buffer, int encodedAccessUnitCount, long presentationTimeUs) {
        ByteBuffer source = buffer.order(ByteOrder.LITTLE_ENDIAN);
        int bytesPerSample = encoding == C.ENCODING_PCM_FLOAT ? 4 : 2;
        int bytesPerFrame = bytesPerSample * inputChannels;
        while (source.remaining() >= bytesPerFrame) {
            int frames = Math.min(
                Math.min(source.remaining() / bytesPerFrame, SCRATCH_FRAMES),
                channel.buffer().writableFrames()
            );
            if (frames == 0) return false;
            for (int frame = 0; frame < frames; frame++) {
                float left = readSample(source);
                float right = inputChannels == 1 ? left : readSample(source);
                for (int extra = 2; extra < inputChannels; extra++) readSample(source);
                scratch[frame * 2] = left;
                scratch[frame * 2 + 1] = right;
            }
            channel.buffer().write(scratch, frames);
        }
        return !source.hasRemaining();
    }

    private float readSample(ByteBuffer source) {
        return encoding == C.ENCODING_PCM_FLOAT
            ? source.getFloat()
            : source.getShort() / 32_768.0f;
    }

    @Override
    public void play() {
        mixer.ensureStarted(audioSessionId);
        channel.setPlaying(true);
    }

    @Override
    public void pause() {
        channel.setPlaying(false);
    }

    @Override
    public void flush() {
        channel.flush();
    }

    @Override
    public void stop() {}

    @Override
    public void release() {
        channel.setPlaying(false);
        channel.flush();
    }

    @Override
    public void setVolume(float volume) {
        channel.setVolume(volume);
    }

    @Override
    public boolean isOffloadedPlayback() {
        return false;
    }

    @Override
    public int getAudioSessionId() {
        return audioSessionId;
    }

    @Override
    public int getSampleRate() {
        return sampleRate;
    }

    @Override
    public long getBufferSizeInFrames() {
        return channel.buffer().capacityFrames();
    }

    @Override
    public long getPositionUs() {
        return channel.consumedFrames() * C.MICROS_PER_SECOND / sampleRate;
    }

    @Override
    public PlaybackParameters getPlaybackParameters() {
        return PlaybackParameters.DEFAULT;
    }

    @Override
    public boolean isStalled() {
        return false;
    }

    @Override
    public void addListener(Listener listener) {}

    @Override
    public void removeListener(Listener listener) {}

    @Override
    public void setPlaybackParameters(PlaybackParameters playbackParameters) {}

    @Override
    public void setOffloadDelayPadding(int delayInFrames, int paddingInFrames) {}

    @Override
    public void setOffloadEndOfStream() {}

    @Override
    public void attachAuxEffect(int effectId) {}

    @Override
    public void setAuxEffectSendLevel(float level) {}

    @Override
    public void setPreferredDevice(AudioDeviceInfo audioDeviceInfo) {}
}
