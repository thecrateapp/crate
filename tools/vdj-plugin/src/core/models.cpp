#include "crate_vdj/core.hpp"

#include <charconv>
#include <cctype>
#include <utility>

namespace crate::vdj {
namespace {

class JsonObjectParser {
public:
    explicit JsonObjectParser(std::string_view input)
        : input_(input)
    {
    }

    ParseResult<Capabilities> parse()
    {
        Capabilities result;
        bool has_contract_version = false;
        bool has_profile_schema_version = false;
        bool has_planner_version = false;
        bool has_online_source = false;
        bool has_smart_mix_assistant = false;
        bool has_automation = false;

        skip_whitespace();
        if (!consume('{')) {
            return failure(ModelErrorCode::InvalidJson, "expected object");
        }

        skip_whitespace();
        if (consume('}')) {
            return failure(ModelErrorCode::MissingField, "empty object");
        }

        while (position_ < input_.size()) {
            std::string key;
            if (!parse_string(key)) {
                return failure(ModelErrorCode::InvalidJson, "invalid key");
            }
            skip_whitespace();
            if (!consume(':')) {
                return failure(ModelErrorCode::InvalidJson, "expected colon");
            }
            skip_whitespace();

            if (key == "min_plugin_version") {
                if (!parse_string(result.min_plugin_version)) {
                    return invalid_field(key);
                }
            } else if (key == "max_plugin_version") {
                if (!parse_string(result.max_plugin_version)) {
                    return invalid_field(key);
                }
            } else if (key == "contract_version") {
                if (!parse_string(result.contract_version)) {
                    return invalid_field(key);
                }
                has_contract_version = true;
            } else if (key == "profile_schema_version") {
                if (!parse_integer(result.profile_schema_version)) {
                    return invalid_field(key);
                }
                has_profile_schema_version = true;
            } else if (key == "planner_version") {
                if (!parse_string(result.planner_version)) {
                    return invalid_field(key);
                }
                has_planner_version = true;
            } else if (key == "online_source") {
                if (!parse_boolean(result.online_source)) {
                    return invalid_field(key);
                }
                has_online_source = true;
            } else if (key == "smart_mix_assistant") {
                if (!parse_boolean(result.smart_mix_assistant)) {
                    return invalid_field(key);
                }
                has_smart_mix_assistant = true;
            } else if (key == "automation") {
                if (!parse_boolean(result.automation)) {
                    return invalid_field(key);
                }
                has_automation = true;
            } else if (key == "vdj") {
                if (!parse_vdj_object(
                        result,
                        has_contract_version,
                        has_profile_schema_version,
                        has_planner_version,
                        has_online_source,
                        has_smart_mix_assistant,
                        has_automation
                    )) {
                    return invalid_field(key);
                }
            } else if (!skip_value()) {
                return failure(
                    ModelErrorCode::InvalidJson,
                    "invalid unknown field"
                );
            }

            skip_whitespace();
            if (consume('}')) {
                break;
            }
            if (!consume(',')) {
                return failure(ModelErrorCode::InvalidJson, "expected comma");
            }
            skip_whitespace();
        }

        if (!has_contract_version || !has_profile_schema_version ||
            !has_planner_version || !has_online_source ||
            !has_smart_mix_assistant || !has_automation) {
            return failure(ModelErrorCode::MissingField, "required field missing");
        }

        if (result.profile_schema_version != 1) {
            return failure(
                ModelErrorCode::UnsupportedSchema,
                "unsupported profile schema"
            );
        }

        if (result.contract_version.empty() || result.planner_version.empty()) {
            return failure(ModelErrorCode::InvalidField, "empty version field");
        }

        skip_whitespace();
        if (position_ != input_.size()) {
            return failure(ModelErrorCode::InvalidJson, "trailing data");
        }

        return ParseResult<Capabilities>{
            .value = std::move(result),
            .error_code = ModelErrorCode::InvalidJson,
            .error = {},
        };
    }

private:
    bool parse_vdj_object(
        Capabilities& result,
        bool& has_contract_version,
        bool& has_profile_schema_version,
        bool& has_planner_version,
        bool& has_online_source,
        bool& has_smart_mix_assistant,
        bool& has_automation
    )
    {
        if (!consume('{')) {
            return false;
        }
        skip_whitespace();
        if (consume('}')) {
            return false;
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
            skip_whitespace();

            if (key == "min_plugin_version") {
                if (!parse_string(result.min_plugin_version)) {
                    return false;
                }
            } else if (key == "max_plugin_version") {
                if (!parse_string(result.max_plugin_version)) {
                    return false;
                }
            } else if (key == "contract_version") {
                if (!parse_string(result.contract_version)) {
                    return false;
                }
                has_contract_version = true;
            } else if (key == "profile_schema_version") {
                if (!parse_integer(result.profile_schema_version)) {
                    return false;
                }
                has_profile_schema_version = true;
            } else if (key == "planner_version") {
                if (!parse_string(result.planner_version)) {
                    return false;
                }
                has_planner_version = true;
            } else if (key == "online_source") {
                if (!parse_boolean(result.online_source)) {
                    return false;
                }
                has_online_source = true;
            } else if (key == "smart_mix_assistant") {
                if (!parse_boolean(result.smart_mix_assistant)) {
                    return false;
                }
                has_smart_mix_assistant = true;
            } else if (key == "automation") {
                if (!parse_boolean(result.automation)) {
                    return false;
                }
                has_automation = true;
            } else if (key == "available") {
                bool available = false;
                if (!parse_boolean(available)) {
                    return false;
                }
            } else if (!skip_value()) {
                return false;
            }

            skip_whitespace();
            if (consume('}')) {
                return true;
            }
            if (!consume(',')) {
                return false;
            }
            skip_whitespace();
        }
        return false;
    }

    ParseResult<Capabilities> failure(
        ModelErrorCode code,
        std::string message
    ) const
    {
        return ParseResult<Capabilities>{
            .value = std::nullopt,
            .error_code = code,
            .error = std::move(message),
        };
    }

    ParseResult<Capabilities> invalid_field(const std::string& key) const
    {
        return failure(
            ModelErrorCode::InvalidField,
            "invalid field: " + key
        );
    }

    void skip_whitespace()
    {
        while (position_ < input_.size() &&
               std::isspace(
                   static_cast<unsigned char>(input_[position_])
               )) {
            ++position_;
        }
    }

    bool consume(char expected)
    {
        if (position_ >= input_.size() || input_[position_] != expected) {
            return false;
        }
        ++position_;
        return true;
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
            if (character == '\\') {
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
            } else {
                output.push_back(character);
            }
        }
        return false;
    }

    bool parse_integer(int& output)
    {
        const auto begin = input_.data() + position_;
        const auto end = input_.data() + input_.size();
        const auto parsed = std::from_chars(begin, end, output);
        if (parsed.ec != std::errc{}) {
            return false;
        }
        position_ = static_cast<std::size_t>(parsed.ptr - input_.data());
        return true;
    }

    bool parse_boolean(bool& output)
    {
        if (input_.substr(position_).starts_with("true")) {
            output = true;
            position_ += 4;
            return true;
        }
        if (input_.substr(position_).starts_with("false")) {
            output = false;
            position_ += 5;
            return true;
        }
        return false;
    }

    bool skip_value()
    {
        skip_whitespace();
        if (position_ >= input_.size()) {
            return false;
        }

        if (input_[position_] == '"') {
            std::string ignored;
            return parse_string(ignored);
        }
        if (input_[position_] == '{') {
            ++position_;
            skip_whitespace();
            if (consume('}')) {
                return true;
            }
            while (position_ < input_.size()) {
                std::string ignored_key;
                if (!parse_string(ignored_key)) {
                    return false;
                }
                skip_whitespace();
                if (!consume(':')) {
                    return false;
                }
                if (!skip_value()) {
                    return false;
                }
                skip_whitespace();
                if (consume('}')) {
                    return true;
                }
                if (!consume(',')) {
                    return false;
                }
                skip_whitespace();
            }
            return false;
        }
        if (input_[position_] == '[') {
            ++position_;
            skip_whitespace();
            if (consume(']')) {
                return true;
            }
            while (position_ < input_.size()) {
                if (!skip_value()) {
                    return false;
                }
                skip_whitespace();
                if (consume(']')) {
                    return true;
                }
                if (!consume(',')) {
                    return false;
                }
                skip_whitespace();
            }
            return false;
        }

        const auto begin = position_;
        while (position_ < input_.size() &&
               input_[position_] != ',' &&
               input_[position_] != '}' &&
               input_[position_] != ']') {
            ++position_;
        }
        return position_ > begin;
    }

    std::string_view input_;
    std::size_t position_ = 0;
};

} // namespace

ParseResult<Capabilities> parse_capabilities_json(std::string_view json)
{
    return JsonObjectParser(json).parse();
}

bool CompletionOnce::try_complete()
{
    bool expected = false;
    return completed_.compare_exchange_strong(
        expected,
        true,
        std::memory_order_acq_rel
    );
}

} // namespace crate::vdj
