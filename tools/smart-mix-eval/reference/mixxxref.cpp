// Offline reference: Mixxx's Queen Mary beat grid (fixed tempo, as AnalyzerBeats
// stores it) plus the Queen Mary and KeyFinder keys of one file. Decodes with
// ffmpeg to stereo float at the native rate. Prints one JSON object.
#include <dsp/keydetection/GetKeyMode.h>
#include <dsp/onsets/DetectionFunction.h>
#include <dsp/tempotracking/TempoTrackV2.h>
#include <keyfinder/keyfinder.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace {

struct Helper {
    std::vector<double> buffer;
    size_t window = 0, step = 0, pos = 0;
    std::function<void(double*)> cb;
    void init(size_t w, size_t s, std::function<void(double*)> c) {
        window = w;
        step = s;
        buffer.assign(w, 0.0);
        pos = w / 2;
        cb = std::move(c);
    }
    void push(const float* in, size_t frames) {
        size_t read = 0;
        while (read < frames) {
            size_t n = std::min(frames - read, window - pos);
            for (size_t i = 0; i < n; ++i) {
                buffer[pos + i] = in ? (in[(read + i) * 2] + in[(read + i) * 2 + 1]) * 0.5 : 0.0;
            }
            pos += n;
            read += n;
            if (pos == window) {
                cb(buffer.data());
                for (size_t i = 0; i < window - step; ++i) {
                    buffer[i] = buffer[i + step];
                }
                pos -= step;
            }
        }
    }
    void finish() {
        size_t fill = window - pos;
        push(nullptr, std::max(fill, window / 2 - 1));
    }
};

constexpr double kMaxSecsPhaseError = 0.025;
constexpr double kMaxSecsPhaseErrorSum = 0.1;
constexpr int kMaxOutliersCount = 1;
constexpr int kMinRegionBeatCount = 16;

struct Region {
    double firstBeat;
    double beatLength;
};

std::vector<Region> constRegions(const std::vector<double>& beats, double sr) {
    const double maxPhaseError = kMaxSecsPhaseError * sr;
    const double maxPhaseErrorSum = kMaxSecsPhaseErrorSum * sr;
    int left = 0;
    int right = static_cast<int>(beats.size()) - 1;
    std::vector<Region> regions;
    while (left < static_cast<int>(beats.size()) - 1) {
        double mean = (beats[right] - beats[left]) / (right - left);
        int outliers = 0;
        double ironed = beats[left];
        double errorSum = 0;
        int i = left + 1;
        for (; i <= right; ++i) {
            ironed += mean;
            double err = ironed - beats[i];
            errorSum += err;
            if (std::fabs(err) > maxPhaseError) {
                outliers++;
                if (outliers > kMaxOutliersCount || i == left + 1) {
                    break;
                }
            }
            if (std::fabs(errorSum) > maxPhaseErrorSum) {
                break;
            }
        }
        if (i > right) {
            double border = 0;
            if (right > left + 2) {
                double firstLen = beats[left + 1] - beats[left];
                double lastLen = beats[right] - beats[right - 1];
                border = std::fabs(firstLen + lastLen - 2 * mean);
            }
            if (border < maxPhaseError / 2) {
                regions.push_back({beats[left], mean});
                left = right;
                right = static_cast<int>(beats.size()) - 1;
                continue;
            }
        }
        right--;
    }
    regions.push_back({beats.back(), 0});
    return regions;
}

std::optional<double> trySnap(double minB, double c, double maxB, double f) {
    double s = std::round(c * f) / f;
    if (s > minB && s < maxB) {
        return s;
    }
    return std::nullopt;
}

double roundBpm(double minB, double c, double maxB) {
    if (auto s = trySnap(minB, c, maxB, 1.0)) return *s;
    if (c < 85.0) {
        if (auto s = trySnap(minB, c, maxB, 2.0)) return *s;
    }
    if (c > 127.0) {
        if (auto s = trySnap(minB, c, maxB, 2.0 / 3.0)) return *s;
    }
    if (auto s = trySnap(minB, c, maxB, 3.0)) return *s;
    if (auto s = trySnap(minB, c, maxB, 12.0)) return *s;
    return c;
}

double makeConstBpm(const std::vector<Region>& r, double sr, double* firstBeat) {
    int mid = 0;
    double longestLen = 0, longestBeat = 0;
    for (int i = 0; i + 1 < static_cast<int>(r.size()); ++i) {
        double len = r[i + 1].firstBeat - r[i].firstBeat;
        if (len > longestLen) {
            longestLen = len;
            longestBeat = r[i].beatLength;
            mid = i;
        }
    }
    if (longestLen == 0) return 0;
    int n = static_cast<int>(longestLen / longestBeat + 0.5);
    double bMin = longestBeat - kMaxSecsPhaseError * sr / n;
    double bMax = longestBeat + kMaxSecsPhaseError * sr / n;
    int start = mid;
    for (int i = 0; i < mid; ++i) {
        double len = r[i + 1].firstBeat - r[i].firstBeat;
        int nb = static_cast<int>(len / r[i].beatLength + 0.5);
        if (nb < kMinRegionBeatCount) continue;
        double tMin = r[i].beatLength - kMaxSecsPhaseError * sr / nb;
        double tMax = r[i].beatLength + kMaxSecsPhaseError * sr / nb;
        if (longestBeat > tMin && longestBeat < tMax) {
            double newLen = r[mid + 1].firstBeat - r[i].firstBeat;
            double lo = std::max(bMin, tMin), hi = std::min(bMax, tMax);
            int maxN = static_cast<int>(std::round(newLen / lo));
            int minN = static_cast<int>(std::round(newLen / hi));
            if (minN != maxN) continue;
            double newBeat = newLen / minN;
            if (newBeat > bMin && newBeat < bMax) {
                longestLen = newLen;
                longestBeat = newBeat;
                n = minN;
                bMin = longestBeat - kMaxSecsPhaseError * sr / n;
                bMax = longestBeat + kMaxSecsPhaseError * sr / n;
                start = i;
                break;
            }
        }
    }
    for (int i = static_cast<int>(r.size()) - 2; i > mid; --i) {
        double len = r[i + 1].firstBeat - r[i].firstBeat;
        int nb = static_cast<int>(len / r[i].beatLength + 0.5);
        if (nb < kMinRegionBeatCount) continue;
        double tMin = r[i].beatLength - kMaxSecsPhaseError * sr / nb;
        double tMax = r[i].beatLength + kMaxSecsPhaseError * sr / nb;
        if (longestBeat > tMin && longestBeat < tMax) {
            double newLen = r[i + 1].firstBeat - r[start].firstBeat;
            double lo = std::max(bMin, tMin), hi = std::min(bMax, tMax);
            int maxN = static_cast<int>(std::round(newLen / lo));
            int minN = static_cast<int>(std::round(newLen / hi));
            if (minN != maxN) continue;
            double newBeat = newLen / minN;
            if (newBeat > bMin && newBeat < bMax) {
                longestLen = newLen;
                longestBeat = newBeat;
                n = minN;
                break;
            }
        }
    }
    bMin = longestBeat - kMaxSecsPhaseError * sr / n;
    bMax = longestBeat + kMaxSecsPhaseError * sr / n;
    double minRound = 60.0 * sr / bMax;
    double maxRound = 60.0 * sr / bMin;
    double center = 60.0 * sr / longestBeat;
    double bpm = roundBpm(minRound, center, maxRound);
    double rounded = 60.0 * sr / bpm;
    *firstBeat = std::fmod(r[start].firstBeat, rounded);
    return bpm;
}

double adjustPhase(double firstBeat, double bpm, double sr, const std::vector<double>& beats) {
    double len = 60 * sr / bpm;
    double startOffset = std::fmod(firstBeat, len);
    double adjust = 0, count = 0;
    for (double b : beats) {
        double off = std::fmod(b - startOffset, len);
        if (off > len / 2) off -= len;
        if (std::fabs(off) < kMaxSecsPhaseError * sr) {
            adjust += off;
            count++;
        }
    }
    return firstBeat + adjust / count;
}

const char* kCamelotMajor[12] = {"8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"};
const char* kCamelotMinor[12] = {"5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"};

std::string camelot(int pitchClass, bool minor) {
    return minor ? kCamelotMinor[pitchClass] : kCamelotMajor[pitchClass];
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: mixxxref <file> <samplerate>\n");
        return 2;
    }
    const std::string path = argv[1];
    const double sr = std::atof(argv[2]);
    // The path goes to the shell inside single quotes.
    if (path.find('\'') != std::string::npos) {
        std::fprintf(stderr, "mixxxref: paths with a single quote are not supported\n");
        return 2;
    }
    const std::string cmd = "ffmpeg -v quiet -i '" + path + "' -f f32le -ac 2 -";
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) return 1;

    const int step = static_cast<int>(sr * 0.01161f);
    const int window = MathUtilities::nextPowerOfTwo(static_cast<int>(sr / 50));
    DFConfig config;
    config.DFType = DF_COMPLEXSD;
    config.stepSize = step;
    config.frameLength = window;
    config.dbRise = 3;
    config.adaptiveWhitening = false;
    config.whiteningRelaxCoeff = -1;
    config.whiteningFloor = -1;
    DetectionFunction df(config);
    std::vector<double> detections;
    Helper beatHelper;
    beatHelper.init(window, step, [&](double* w) { detections.push_back(df.processTimeDomain(w)); });

    GetKeyMode::Config keyConfig(sr, 440);
    GetKeyMode keyMode(keyConfig);
    std::map<int, double> keyDurations;
    int prevKey = -1;
    double prevKeyFrame = 0;
    double currentFrame = 0;
    Helper keyHelper;
    keyHelper.init(keyMode.getBlockSize(), keyMode.getHopSize(), [&](double* w) {
        int k = keyMode.process(w);
        if (k != prevKey) {
            if (prevKey >= 0) keyDurations[prevKey] += currentFrame - prevKeyFrame;
            prevKey = k;
            prevKeyFrame = currentFrame;
        }
    });

    KeyFinder::KeyFinder keyFinder;
    KeyFinder::Workspace workspace;

    constexpr size_t kChunk = 8192;
    std::vector<float> chunk(kChunk * 2);
    size_t totalFrames = 0;
    while (true) {
        size_t got = fread(chunk.data(), sizeof(float) * 2, kChunk, pipe);
        if (got == 0) break;
        beatHelper.push(chunk.data(), got);
        currentFrame += got;
        keyHelper.push(chunk.data(), got);
        KeyFinder::AudioData audio;
        audio.setFrameRate(static_cast<unsigned int>(sr));
        audio.setChannels(2);
        audio.addToSampleCount(got * 2);
        for (size_t f = 0; f < got; ++f) {
            audio.setSampleByFrame(f, 0, chunk[f * 2]);
            audio.setSampleByFrame(f, 1, chunk[f * 2 + 1]);
        }
        keyFinder.progressiveChromagram(audio, workspace);
        totalFrames += got;
    }
    pclose(pipe);
    beatHelper.finish();
    keyHelper.finish();
    if (prevKey >= 0) keyDurations[prevKey] += currentFrame - prevKeyFrame;
    keyFinder.finalChromagram(workspace);
    const KeyFinder::key_t kf = keyFinder.keyOfChromagram(workspace);

    size_t nonZero = detections.size();
    while (nonZero > 0 && detections[nonZero - 1] <= 0.0) --nonZero;
    std::vector<double> dfv;
    for (size_t i = 2; i < nonZero; ++i) dfv.push_back(detections[i]);
    std::vector<int> beatPeriod(dfv.size() / 128 + 1);
    TempoTrackV2 tt(static_cast<float>(sr), step);
    tt.calculateBeatPeriod(dfv, beatPeriod);
    std::vector<double> beatIdx;
    tt.calculateBeats(dfv, beatPeriod, beatIdx);
    std::vector<double> beats;
    for (double b : beatIdx) beats.push_back(b * step + step / 2);

    double firstBeat = 0;
    double bpm = 0;
    if (beats.size() >= 2) {
        auto regions = constRegions(beats, sr);
        bpm = makeConstBpm(regions, sr, &firstBeat);
        if (bpm > 0) firstBeat = std::round(adjustPhase(firstBeat, bpm, sr, beats));
    }

    int qmKey = 0;
    double best = -1;
    for (auto& [k, d] : keyDurations) {
        if (d > best) {
            best = d;
            qmKey = k;
        }
    }
    std::string qmCamelot = "";
    if (qmKey >= 1 && qmKey <= 24) {
        qmCamelot = camelot((qmKey - 1) % 12, qmKey > 12);
    }
    std::string kfCamelot = "";
    if (kf != KeyFinder::SILENCE) {
        int pcFromA = static_cast<int>(kf) / 2;
        kfCamelot = camelot((pcFromA + 9) % 12, static_cast<int>(kf) % 2 == 1);
    }

    std::printf("{\"sampleRate\":%.0f,\"frames\":%zu,\"bpm\":%.6f,\"firstBeatMs\":%.4f,"
                "\"qmKey\":\"%s\",\"keyfinderKey\":\"%s\",\"rawBeatsMs\":[",
            sr, totalFrames, bpm, firstBeat * 1000.0 / sr, qmCamelot.c_str(), kfCamelot.c_str());
    for (size_t i = 0; i < beats.size(); ++i) {
        std::printf("%s%.3f", i ? "," : "", beats[i] * 1000.0 / sr);
    }
    std::printf("]}\n");
    return 0;
}
