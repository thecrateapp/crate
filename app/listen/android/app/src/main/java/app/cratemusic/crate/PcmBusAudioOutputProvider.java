package app.cratemusic.crate;

import android.media.AudioFormat;

import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.Util;
import androidx.media3.exoplayer.audio.AudioOutput;
import androidx.media3.exoplayer.audio.AudioOutputProvider;

@UnstableApi
final class PcmBusAudioOutputProvider implements AudioOutputProvider {
    private final PcmBusMixer mixer;
    private final PcmBusChannel channel;

    PcmBusAudioOutputProvider(PcmBusMixer mixer, PcmBusChannel channel) {
        this.mixer = mixer;
        this.channel = channel;
    }

    @Override
    public FormatSupport getFormatSupport(FormatConfig formatConfig) {
        Format format = formatConfig.format;
        boolean supported =
            MimeTypes.AUDIO_RAW.equals(format.sampleMimeType) &&
            Util.isEncodingLinearPcm(format.pcmEncoding) &&
            format.channelCount >= 1 &&
            format.channelCount <= 2;
        return supported
            ? new FormatSupport.Builder()
                .setFormatSupportLevel(FORMAT_SUPPORTED_DIRECTLY)
                .build()
            : FormatSupport.UNSUPPORTED;
    }

    @Override
    public OutputConfig getOutputConfig(FormatConfig formatConfig) {
        Format format = formatConfig.format;
        return new OutputConfig.Builder()
            .setEncoding(format.pcmEncoding)
            .setSampleRate(format.sampleRate)
            .setChannelMask(
                format.channelCount == 1
                    ? AudioFormat.CHANNEL_OUT_MONO
                    : AudioFormat.CHANNEL_OUT_STEREO
            )
            .setBufferSize(channel.buffer().capacityFrames() * format.channelCount * 4)
            .setAudioSessionId(formatConfig.audioSessionId)
            .setUsePlaybackParameters(false)
            .build();
    }

    @Override
    public AudioOutput getAudioOutput(OutputConfig outputConfig) {
        int channelCount = outputConfig.channelMask == AudioFormat.CHANNEL_OUT_MONO ? 1 : 2;
        return new PcmBusAudioOutput(
            channel,
            mixer,
            outputConfig.encoding,
            channelCount,
            outputConfig.sampleRate,
            outputConfig.audioSessionId
        );
    }

    @Override
    public void addListener(Listener listener) {}

    @Override
    public void removeListener(Listener listener) {}

    @Override
    public void release() {}
}
