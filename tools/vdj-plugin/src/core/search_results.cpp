#include "crate_vdj/models.hpp"

#include <charconv>
#include <cctype>
#include <cmath>
#include <map>
#include <string>
#include <utility>

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

class JsonReader {
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
            skip_whitespace();
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

    bool parse_string(std::string& value)
    {
        if (!consume('"')) {
            return false;
        }
        value.clear();
        while (position_ < input_.size()) {
            const char character = input_[position_++];
            if (character == '"') {
                return true;
            }
            if (character != '\\') {
                value.push_back(character);
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
                value.push_back(escaped);
                break;
            case 'b':
                value.push_back('\b');
                break;
            case 'f':
                value.push_back('\f');
                break;
            case 'n':
                value.push_back('\n');
                break;
            case 'r':
                value.push_back('\r');
                break;
            case 't':
                value.push_back('\t');
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
        if (end == begin) {
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

bool string_field(
    const JsonValue& object,
    std::string_view name,
    std::string& output,
    bool required
)
{
    const auto* value = field(object, name);
    if (value == nullptr) {
        return !required;
    }
    if (value->kind != JsonValue::Kind::String) {
        return false;
    }
    output = value->string_value;
    return !required || !output.empty();
}

bool integer_field(
    const JsonValue& object,
    std::string_view name,
    int& output,
    bool required
)
{
    const auto* value = field(object, name);
    if (value == nullptr) {
        return !required;
    }
    if (value->kind == JsonValue::Kind::Number) {
        if (!std::isfinite(value->number_value) ||
            std::floor(value->number_value) != value->number_value) {
            return false;
        }
        output = static_cast<int>(value->number_value);
        return true;
    }
    if (value->kind != JsonValue::Kind::String || value->string_value.empty()) {
        return false;
    }
    const auto parsed = std::from_chars(
        value->string_value.data(),
        value->string_value.data() + value->string_value.size(),
        output
    );
    return parsed.ec == std::errc{} && parsed.ptr ==
        value->string_value.data() + value->string_value.size();
}

bool number_field(
    const JsonValue& object,
    std::string_view name,
    double& output,
    bool required
)
{
    const auto* value = field(object, name);
    if (value == nullptr) {
        return !required;
    }
    if (value->kind != JsonValue::Kind::Number ||
        !std::isfinite(value->number_value)) {
        return false;
    }
    output = value->number_value;
    return true;
}

bool boolean_field(
    const JsonValue& object,
    std::string_view name,
    bool& output,
    bool required
)
{
    const auto* value = field(object, name);
    if (value == nullptr) {
        return !required;
    }
    if (value->kind != JsonValue::Kind::Boolean) {
        return false;
    }
    output = value->boolean_value;
    return true;
}

ParseResult<SearchResults> invalid(ModelErrorCode code, std::string message)
{
    return ParseResult<SearchResults>{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
    };
}

} // namespace

ParseResult<SearchResults> parse_search_json(std::string_view json)
{
    JsonValue root;
    if (!JsonReader(json).parse(root)) {
        return invalid(ModelErrorCode::InvalidJson, "invalid search response JSON");
    }
    if (root.kind != JsonValue::Kind::Object) {
        return invalid(ModelErrorCode::InvalidField, "search response must be an object");
    }

    SearchResults results;
    const auto parse_array = [&](std::string_view name, auto parse_item) {
        const auto* value = field(root, name);
        if (value == nullptr) {
            return true;
        }
        if (value->kind != JsonValue::Kind::Array) {
            return false;
        }
        for (const auto& item : value->array_value) {
            if (!parse_item(item)) {
                return false;
            }
        }
        return true;
    };

    if (!parse_array("artists", [&](const JsonValue& item) {
            SearchArtist artist;
            return string_field(item, "entity_uid", artist.entity_uid, true) &&
                   string_field(item, "name", artist.name, true) &&
                   string_field(item, "slug", artist.slug, false) &&
                   (results.artists.push_back(std::move(artist)), true);
        }) ||
        !parse_array("albums", [&](const JsonValue& item) {
            SearchAlbum album;
            return string_field(item, "entity_uid", album.entity_uid, true) &&
                   string_field(item, "name", album.name, true) &&
                   string_field(item, "artist", album.artist, false) &&
                   (results.albums.push_back(std::move(album)), true);
        }) ||
        !parse_array("tracks", [&](const JsonValue& item) {
            SearchTrack track;
            if (!string_field(item, "entity_uid", track.entity_uid, true) ||
                !string_field(item, "title", track.title, true) ||
                !string_field(item, "artist", track.artist, false) ||
                !string_field(item, "album", track.album, false) ||
                !string_field(item, "path", track.path, false)) {
                return false;
            }
            if (const auto* duration = field(item, "duration"); duration != nullptr) {
                if (duration->kind != JsonValue::Kind::Number) {
                    return false;
                }
                track.duration_seconds = duration->number_value;
            }
            if (!integer_field(item, "year", track.year, false) ||
                !string_field(item, "genre", track.genre, false) ||
                !number_field(item, "bpm", track.bpm, false) ||
                !string_field(item, "audio_key", track.audio_key, false) ||
                !string_field(item, "audio_scale", track.audio_scale, false) ||
                !boolean_field(item, "has_cover", track.has_cover, false) ||
                !string_field(item, "cover_url", track.cover_url, false)) {
                return false;
            }
            results.tracks.push_back(std::move(track));
            return true;
        })) {
        return invalid(ModelErrorCode::InvalidField, "invalid search result field");
    }

    return ParseResult<SearchResults>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace crate::vdj
