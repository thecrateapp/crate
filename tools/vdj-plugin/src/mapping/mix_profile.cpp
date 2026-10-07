#include "crate_vdj/mix_profile.hpp"

#include <charconv>
#include <cctype>
#include <cmath>
#include <limits>
#include <map>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace crate::vdj {
namespace {

struct JsonValue {
    enum class Kind {
        Null,
        Boolean,
        Number,
        String,
        Array,
        Object,
    };

    Kind kind = Kind::Null;
    bool boolean_value = false;
    double number_value = 0;
    std::string string_value;
    std::vector<JsonValue> array_value;
    std::map<std::string, JsonValue> object_value;
};

class JsonReader final {
public:
    explicit JsonReader(std::string_view input)
        : input_(input)
    {
    }

    bool parse(JsonValue& value)
    {
        skip_whitespace();
        if (!parse_value(value)) {
            return false;
        }
        skip_whitespace();
        return position_ == input_.size();
    }

private:
    bool parse_value(JsonValue& value)
    {
        skip_whitespace();
        if (position_ >= input_.size()) {
            return false;
        }
        switch (input_[position_]) {
        case '{':
            return parse_object(value);
        case '"':
            value.kind = JsonValue::Kind::String;
            return parse_string(value.string_value);
        case 'n':
            return parse_null(value);
        case 't':
            return parse_literal(value, "true", true);
        case 'f':
            return parse_literal(value, "false", false);
        case '[':
            return parse_array(value);
        default:
            return parse_number(value);
        }
    }

    bool parse_array(JsonValue& value)
    {
        if (!consume('[')) {
            return false;
        }
        value.kind = JsonValue::Kind::Array;
        value.array_value.clear();
        skip_whitespace();
        if (consume(']')) {
            return true;
        }
        while (position_ < input_.size()) {
            JsonValue child;
            if (!parse_value(child)) {
                return false;
            }
            value.array_value.push_back(std::move(child));
            skip_whitespace();
            if (consume(']')) {
                return true;
            }
            if (!consume(',')) {
                return false;
            }
        }
        return false;
    }

    bool parse_object(JsonValue& value)
    {
        if (!consume('{')) {
            return false;
        }
        value.kind = JsonValue::Kind::Object;
        value.object_value.clear();
        skip_whitespace();
        if (consume('}')) {
            return true;
        }
        while (position_ < input_.size()) {
            std::string key;
            if (!parse_string(key)) {
                return false;
            }
            skip_whitespace();
            if (!consume(':')) {
                return false;
            }
            JsonValue child;
            if (!parse_value(child)) {
                return false;
            }
            value.object_value.insert_or_assign(std::move(key), std::move(child));
            skip_whitespace();
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return false;
            }
        }
        return false;
    }

    bool parse_string(std::string& output)
    {
        if (!consume('"')) {
            return false;
        }
        output.clear();
        while (position_ < input_.size()) {
            const char character = input_[position_++];
            if (character == '"') {
                return true;
            }
            if (character != '\\') {
                output.push_back(character);
                continue;
            }
            if (position_ >= input_.size()) {
                return false;
            }
            const char escaped = input_[position_++];
            switch (escaped) {
            case '"':
            case '\\':
            case '/':
                output.push_back(escaped);
                break;
            case 'b':
                output.push_back('\b');
                break;
            case 'f':
                output.push_back('\f');
                break;
            case 'n':
                output.push_back('\n');
                break;
            case 'r':
                output.push_back('\r');
                break;
            case 't':
                output.push_back('\t');
                break;
            default:
                return false;
            }
        }
        return false;
    }

    bool parse_null(JsonValue& value)
    {
        if (!input_.substr(position_).starts_with("null")) {
            return false;
        }
        position_ += 4;
        value.kind = JsonValue::Kind::Null;
        return true;
    }

    bool parse_literal(JsonValue& value, std::string_view literal, bool boolean)
    {
        if (!input_.substr(position_).starts_with(literal)) {
            return false;
        }
        position_ += literal.size();
        value.kind = JsonValue::Kind::Boolean;
        value.boolean_value = boolean;
        return true;
    }

    bool parse_number(JsonValue& value)
    {
        const auto begin = input_.data() + position_;
        auto end = begin;
        while (end != input_.data() + input_.size() &&
               !std::isspace(static_cast<unsigned char>(*end)) &&
               *end != ',' && *end != '}' && *end != ']') {
            ++end;
        }
        if (begin == end) {
            return false;
        }
        const auto parsed = std::from_chars(begin, end, value.number_value);
        if (parsed.ec != std::errc{} || parsed.ptr != end) {
            return false;
        }
        value.kind = JsonValue::Kind::Number;
        position_ = static_cast<std::size_t>(end - input_.data());
        return true;
    }

    void skip_whitespace()
    {
        while (position_ < input_.size() &&
               std::isspace(static_cast<unsigned char>(input_[position_]))) {
            ++position_;
        }
    }

    bool consume(char expected)
    {
        skip_whitespace();
        if (position_ >= input_.size() || input_[position_] != expected) {
            return false;
        }
        ++position_;
        return true;
    }

    std::string_view input_;
    std::size_t position_ = 0;
};

const JsonValue* field(const JsonValue& object, std::string_view name)
{
    if (object.kind != JsonValue::Kind::Object) {
        return nullptr;
    }
    const auto found = object.object_value.find(std::string(name));
    return found == object.object_value.end() ? nullptr : &found->second;
}

template <typename T>
ParseResult<T> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<T>{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
    };
}

bool required_string(
    const JsonValue& object,
    std::string_view name,
    std::string& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind != JsonValue::Kind::String ||
        value->string_value.empty()) {
        return false;
    }
    output = value->string_value;
    return true;
}

bool optional_string(
    const JsonValue& object,
    std::string_view name,
    std::optional<std::string>& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind == JsonValue::Kind::Null) {
        output.reset();
        return true;
    }
    if (value->kind != JsonValue::Kind::String) {
        return false;
    }
    output = value->string_value;
    return true;
}

bool required_integer(
    const JsonValue& object,
    std::string_view name,
    std::int64_t& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value) ||
        std::floor(value->number_value) != value->number_value) {
        return false;
    }
    output = static_cast<std::int64_t>(value->number_value);
    return true;
}

bool optional_integer(
    const JsonValue& object,
    std::string_view name,
    std::optional<std::int64_t>& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind == JsonValue::Kind::Null) {
        output.reset();
        return true;
    }
    if (value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value) ||
        std::floor(value->number_value) != value->number_value ||
        value->number_value < 0) {
        return false;
    }
    output = static_cast<std::int64_t>(value->number_value);
    return true;
}

bool optional_int(
    const JsonValue& object,
    std::string_view name,
    std::optional<int>& output
)
{
    std::optional<std::int64_t> value;
    if (!optional_integer(object, name, value)) {
        return false;
    }
    if (value.has_value() && *value > std::numeric_limits<int>::max()) {
        return false;
    }
    output = value.has_value() ? std::optional<int>(static_cast<int>(*value))
                               : std::nullopt;
    return true;
}

bool optional_number(
    const JsonValue& object,
    std::string_view name,
    std::optional<double>& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind == JsonValue::Kind::Null) {
        output.reset();
        return true;
    }
    if (value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value)) {
        return false;
    }
    output = value->number_value;
    return true;
}

bool optional_confidence(
    const JsonValue& object,
    std::string_view name,
    std::optional<double>& output
)
{
    if (!optional_number(object, name, output)) {
        return false;
    }
    return !output.has_value() || (*output >= 0.0 && *output <= 1.0);
}

bool quality_value(std::string_view value, MixProfileQuality& output)
{
    if (value == "full") {
        output = MixProfileQuality::Full;
    } else if (value == "partial") {
        output = MixProfileQuality::Partial;
    } else if (value == "legacy") {
        output = MixProfileQuality::Legacy;
    } else if (value == "unavailable") {
        output = MixProfileQuality::Unavailable;
    } else {
        return false;
    }
    return true;
}

} // namespace

ParseResult<MixProfile> parse_mix_profile_json(std::string_view json)
{
    JsonValue root;
    JsonReader reader(json);
    if (!reader.parse(root)) {
        return failure<MixProfile>(ModelErrorCode::InvalidJson, "invalid mix profile JSON");
    }

    MixProfile profile;
    std::int64_t profile_version = 0;
    std::int64_t duration_ms = 0;
    std::string quality;
    if (!required_string(root, "trackEntityUid", profile.track_entity_uid) ||
        !required_integer(root, "profileVersion", profile_version) ||
        !required_string(root, "profileRevision", profile.profile_revision) ||
        !required_string(root, "analyzer", profile.analyzer) ||
        !required_string(root, "analyzerVersion", profile.analyzer_version) ||
        !required_string(root, "sourceRevision", profile.source_revision) ||
        !required_integer(root, "durationMs", duration_ms) ||
        !required_string(root, "quality", quality) ||
        !required_string(root, "analyzedAt", profile.analyzed_at) ||
        !quality_value(quality, profile.quality)) {
        return failure<MixProfile>(
            ModelErrorCode::InvalidField,
            "invalid required Smart Mix profile field"
        );
    }
    if (profile_version < 1 || profile_version > std::numeric_limits<int>::max() ||
        duration_ms < 0) {
        return failure<MixProfile>(
            ModelErrorCode::InvalidField,
            "invalid Smart Mix profile version or duration"
        );
    }
    profile.profile_version = static_cast<int>(profile_version);
    profile.duration_ms = duration_ms;
    if (profile.profile_version != kSmartMixProfileVersion) {
        return failure<MixProfile>(
            ModelErrorCode::UnsupportedSchema,
            "unsupported Smart Mix profile version"
        );
    }
    if (profile.analyzer_version != kSmartMixAnalyzerVersion) {
        return failure<MixProfile>(
            ModelErrorCode::UnsupportedSchema,
            "unsupported Smart Mix analyzer version"
        );
    }

    if (!optional_number(root, "bpm", profile.bpm) ||
        !optional_confidence(root, "bpmConfidence", profile.bpm_confidence) ||
        !optional_confidence(root, "tempoStability", profile.tempo_stability) ||
        !optional_integer(root, "beatAnchorMs", profile.beat_anchor_ms) ||
        !optional_integer(root, "downbeatAnchorMs", profile.downbeat_anchor_ms) ||
        !optional_int(root, "timeSignature", profile.time_signature) ||
        !optional_string(root, "beatGridFormat", profile.beat_grid_format) ||
        !optional_string(root, "key", profile.key) ||
        !optional_string(root, "scale", profile.scale) ||
        !optional_string(root, "camelot", profile.camelot) ||
        !optional_confidence(root, "keyConfidence", profile.key_confidence) ||
        !optional_integer(root, "introCueMs", profile.intro_cue_ms) ||
        !optional_integer(root, "outroCueMs", profile.outro_cue_ms) ||
        !optional_number(root, "introLufs", profile.intro_lufs) ||
        !optional_number(root, "outroLufs", profile.outro_lufs) ||
        !optional_number(root, "truePeakDbfs", profile.true_peak_dbfs) ||
        !optional_confidence(root, "introEnergy", profile.intro_energy) ||
        !optional_confidence(root, "outroEnergy", profile.outro_energy) ||
        !optional_confidence(
            root,
            "introSpectralDensity",
            profile.intro_spectral_density
        ) ||
        !optional_confidence(
            root,
            "outroSpectralDensity",
            profile.outro_spectral_density
        ) ||
        !optional_confidence(root, "globalEnergy", profile.global_energy) ||
        !optional_confidence(root, "danceability", profile.danceability) ||
        !optional_confidence(root, "valence", profile.valence) ||
        !optional_string(
            root,
            "blissVectorRevision",
            profile.bliss_vector_revision
        )) {
        return failure<MixProfile>(
            ModelErrorCode::InvalidField,
            "invalid optional Smart Mix profile field"
        );
    }

    return ParseResult<MixProfile>{
        .value = std::move(profile),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace crate::vdj
