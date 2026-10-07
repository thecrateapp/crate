#include "crate_vdj/compatible_tracks.hpp"

#include <charconv>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <limits>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace crate::vdj {
namespace {

struct JsonValue {
    enum class Kind { Null, Boolean, Number, String, Array, Object };

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
        case '[':
            return parse_array(value);
        case '"':
            value.kind = JsonValue::Kind::String;
            return parse_string(value.string_value);
        case 't':
            return parse_literal(value, "true", JsonValue::Kind::Boolean, true);
        case 'f':
            return parse_literal(value, "false", JsonValue::Kind::Boolean, false);
        case 'n':
            return parse_literal(value, "null", JsonValue::Kind::Null, false);
        default:
            return parse_number(value);
        }
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
            if (!consume(':')) {
                return false;
            }
            JsonValue child;
            if (!parse_value(child)) {
                return false;
            }
            value.object_value.insert_or_assign(std::move(key), std::move(child));
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return false;
            }
        }
        return false;
    }

    bool parse_array(JsonValue& value)
    {
        if (!consume('[')) {
            return false;
        }
        value.kind = JsonValue::Kind::Array;
        value.array_value.clear();
        if (consume(']')) {
            return true;
        }
        while (position_ < input_.size()) {
            JsonValue child;
            if (!parse_value(child)) {
                return false;
            }
            value.array_value.push_back(std::move(child));
            if (consume(']')) {
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

    bool parse_number(JsonValue& value)
    {
        const auto begin = input_.data() + position_;
        auto end = begin;
        while (end != input_.data() + input_.size() &&
               !std::isspace(static_cast<unsigned char>(*end)) &&
               *end != ',' && *end != ']' && *end != '}') {
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

    bool parse_literal(
        JsonValue& value,
        std::string_view literal,
        JsonValue::Kind kind,
        bool boolean_value
    )
    {
        if (!input_.substr(position_).starts_with(literal)) {
            return false;
        }
        position_ += literal.size();
        value.kind = kind;
        value.boolean_value = boolean_value;
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
ParseResult<T> invalid(std::string message)
{
    return ParseResult<T>{
        .value = std::nullopt,
        .error_code = ModelErrorCode::InvalidField,
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

bool required_integer(
    const JsonValue& object,
    std::string_view name,
    int& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value) ||
        std::floor(value->number_value) != value->number_value ||
        value->number_value < std::numeric_limits<int>::min() ||
        value->number_value > std::numeric_limits<int>::max()) {
        return false;
    }
    output = static_cast<int>(value->number_value);
    return true;
}

bool required_number(
    const JsonValue& object,
    std::string_view name,
    double& output
)
{
    const auto* value = field(object, name);
    if (value == nullptr || value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value)) {
        return false;
    }
    output = value->number_value;
    return true;
}

bool unit_number(
    const JsonValue& object,
    std::string_view name,
    double& output
)
{
    return required_number(object, name, output) && output >= 0.0 &&
        output <= 1.0;
}

bool parse_breakdown(
    const JsonValue& value,
    CompatibilityScoreBreakdown& breakdown
)
{
    return required_integer(
            value,
            "plannerVersion",
            breakdown.planner_version
        ) &&
        breakdown.planner_version == kSmartMixProfileVersion &&
        unit_number(value, "overall", breakdown.overall) &&
        unit_number(value, "signalConfidence", breakdown.signal_confidence) &&
        unit_number(value, "tempo", breakdown.tempo) &&
        unit_number(value, "harmonic", breakdown.harmonic) &&
        required_string(
            value,
            "harmonicRelationship",
            breakdown.harmonic_relationship
        ) &&
        unit_number(value, "energy", breakdown.energy) &&
        unit_number(value, "danceability", breakdown.danceability) &&
        unit_number(value, "valence", breakdown.valence) &&
        unit_number(value, "bliss", breakdown.bliss) &&
        unit_number(value, "genre", breakdown.genre);
}

bool parse_item(const JsonValue& value, CompatibleTrack& item)
{
    const auto* breakdown = field(value, "scoreBreakdown");
    const auto* reasons = field(value, "fallbackReasons");
    if (breakdown == nullptr || breakdown->kind != JsonValue::Kind::Object ||
        (reasons != nullptr && reasons->kind != JsonValue::Kind::Array)) {
        return false;
    }
    if (!required_integer(value, "trackId", item.track_id) ||
        item.track_id <= 0 ||
        !required_string(value, "trackEntityUid", item.track_entity_uid) ||
        !required_string(value, "title", item.title) ||
        !required_string(value, "artist", item.artist) ||
        !required_string(value, "album", item.album) ||
        !unit_number(value, "score", item.score) ||
        !unit_number(value, "confidence", item.confidence) ||
        !parse_breakdown(*breakdown, item.score_breakdown)) {
        return false;
    }
    if (reasons != nullptr) {
        for (const auto& reason : reasons->array_value) {
            if (reason.kind != JsonValue::Kind::String ||
                reason.string_value.empty()) {
                return false;
            }
            item.fallback_reasons.push_back(reason.string_value);
        }
    }
    return true;
}

} // namespace

ParseResult<CompatibleTracks> parse_compatible_tracks_json(std::string_view json)
{
    JsonValue root;
    if (!JsonReader(json).parse(root)) {
        return {
            .value = std::nullopt,
            .error_code = ModelErrorCode::InvalidJson,
            .error = "invalid compatible tracks response JSON",
        };
    }

    CompatibleTracks results;
    std::string scope;
    if (!required_string(
            root,
            "seedTrackEntityUid",
            results.seed_track_entity_uid
        ) ||
        !required_string(root, "scope", scope) || scope != "local" ||
        !required_string(
            root,
            "plannerVersion",
            results.planner_version
        ) || results.planner_version != kSmartMixAnalyzerVersion) {
        return invalid<CompatibleTracks>(
            "invalid compatible tracks contract metadata"
        );
    }
    results.scope = std::move(scope);

    const auto* items = field(root, "items");
    if (items == nullptr || items->kind != JsonValue::Kind::Array) {
        return invalid<CompatibleTracks>(
            "compatible tracks items must be an array"
        );
    }
    results.items.reserve(items->array_value.size());
    for (const auto& item_value : items->array_value) {
        CompatibleTrack item;
        if (item_value.kind != JsonValue::Kind::Object ||
            !parse_item(item_value, item)) {
            return invalid<CompatibleTracks>("invalid compatible track item");
        }
        results.items.push_back(std::move(item));
    }

    return ParseResult<CompatibleTracks>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

SearchTrack compatible_track_as_search_track(const CompatibleTrack& track)
{
    SearchTrack mapped;
    mapped.entity_uid = track.track_entity_uid;
    mapped.title = track.title;
    mapped.artist = track.artist;
    mapped.album = track.album;
    return mapped;
}

std::string compatible_track_comment(const CompatibleTrack& track)
{
    const auto& breakdown = track.score_breakdown;
    std::ostringstream output;
    output << std::fixed << std::setprecision(2)
           << "Smart Mix score=" << track.score
           << " confidence=" << track.confidence
           << " tempo=" << breakdown.tempo
           << " harmonic=" << breakdown.harmonic_relationship
           << " energy=" << breakdown.energy
           << " danceability=" << breakdown.danceability
           << " valence=" << breakdown.valence
           << " bliss=" << breakdown.bliss
           << " genre=" << breakdown.genre;
    if (!track.fallback_reasons.empty()) {
        output << " fallback=";
        for (std::size_t index = 0;
             index < track.fallback_reasons.size();
             ++index) {
            if (index > 0) {
                output << ',';
            }
            output << track.fallback_reasons[index];
        }
    }
    return output.str();
}

} // namespace crate::vdj
