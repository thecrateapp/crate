#include "crate_vdj/json_mapping.hpp"

#include <cmath>

namespace crate::vdj::json {
namespace {

bool integral_value(
    const Value& value,
    std::int64_t minimum,
    std::int64_t maximum,
    std::int64_t& output
)
{
    if (value.is_number_unsigned()) {
        const auto number = value.get<std::uint64_t>();
        if (maximum < 0 || number > static_cast<std::uint64_t>(maximum)) {
            return false;
        }
        output = static_cast<std::int64_t>(number);
        return output >= minimum;
    }
    if (value.is_number_integer()) {
        output = value.get<std::int64_t>();
        return output >= minimum && output <= maximum;
    }
    if (value.is_number_float()) {
        const auto number = value.get<double>();
        if (!std::isfinite(number) || std::floor(number) != number ||
            number < static_cast<double>(minimum) ||
            number > static_cast<double>(maximum)) {
            return false;
        }
        output = static_cast<std::int64_t>(number);
        return true;
    }
    return false;
}

bool finite_number(const Value& value, double& output)
{
    if (!value.is_number()) {
        return false;
    }
    output = value.get<double>();
    return std::isfinite(output);
}

bool absent(const Value* value)
{
    return value == nullptr || value->is_null();
}

} // namespace

ParseResult<Value> parse_bounded(std::string_view body, const Limits& limits)
{
    if (body.size() > limits.max_body_bytes) {
        return failure<Value>(ModelErrorCode::InvalidResponse, "response body too large");
    }
    bool too_deep = false;
    bool too_many_items = false;
    const Value::parser_callback_t guard =
        [&](int depth, Value::parse_event_t event, Value& parsed) {
            if ((event == Value::parse_event_t::object_start ||
                 event == Value::parse_event_t::array_start) &&
                static_cast<std::size_t>(depth) >= limits.max_depth) {
                too_deep = true;
            }
            if ((event == Value::parse_event_t::object_end ||
                 event == Value::parse_event_t::array_end) &&
                parsed.size() > limits.max_collection_items) {
                too_many_items = true;
            }
            return true;
        };
    auto parsed = Value::parse(body.begin(), body.end(), guard, false);
    if (parsed.is_discarded()) {
        return failure<Value>(ModelErrorCode::InvalidJson, "invalid JSON");
    }
    if (too_deep) {
        return failure<Value>(ModelErrorCode::InvalidResponse, "JSON nested too deeply");
    }
    if (too_many_items) {
        return failure<Value>(ModelErrorCode::InvalidResponse, "JSON collection too large");
    }
    return success(std::move(parsed));
}

ParseResult<Value> parse_object(std::string_view body, const Limits& limits)
{
    auto parsed = parse_bounded(body, limits);
    if (parsed.ok() && !parsed.value->is_object()) {
        return failure<Value>(ModelErrorCode::InvalidField, "JSON response must be an object");
    }
    return parsed;
}

const Value* member(const Value& object, std::string_view name)
{
    if (!object.is_object()) {
        return nullptr;
    }
    const auto found = object.find(name);
    return found == object.end() ? nullptr : &*found;
}

bool required_string(const Value& object, std::string_view name, std::string& output)
{
    const auto* value = member(object, name);
    if (value == nullptr || !value->is_string()) {
        return false;
    }
    output = value->get<std::string>();
    return !output.empty();
}

bool optional_string(const Value& object, std::string_view name, std::string& output)
{
    const auto* value = member(object, name);
    if (absent(value)) {
        return true;
    }
    if (!value->is_string()) {
        return false;
    }
    output = value->get<std::string>();
    return true;
}

bool optional_string(
    const Value& object,
    std::string_view name,
    std::optional<std::string>& output
)
{
    const auto* value = member(object, name);
    if (absent(value)) {
        output.reset();
        return true;
    }
    if (!value->is_string()) {
        return false;
    }
    output = value->get<std::string>();
    return true;
}

bool required_integer(
    const Value& object,
    std::string_view name,
    std::int64_t& output,
    std::int64_t minimum,
    std::int64_t maximum
)
{
    const auto* value = member(object, name);
    return value != nullptr && integral_value(*value, minimum, maximum, output);
}

bool optional_integer(
    const Value& object,
    std::string_view name,
    std::optional<std::int64_t>& output,
    std::int64_t minimum,
    std::int64_t maximum
)
{
    const auto* value = member(object, name);
    if (absent(value)) {
        output.reset();
        return true;
    }
    std::int64_t number = 0;
    if (!integral_value(*value, minimum, maximum, number)) {
        return false;
    }
    output = number;
    return true;
}

bool required_number(const Value& object, std::string_view name, double& output)
{
    const auto* value = member(object, name);
    return value != nullptr && finite_number(*value, output);
}

bool optional_number(
    const Value& object,
    std::string_view name,
    std::optional<double>& output
)
{
    const auto* value = member(object, name);
    if (absent(value)) {
        output.reset();
        return true;
    }
    double number = 0;
    if (!finite_number(*value, number)) {
        return false;
    }
    output = number;
    return true;
}

bool optional_number(const Value& object, std::string_view name, double& output)
{
    const auto* value = member(object, name);
    return absent(value) || finite_number(*value, output);
}

bool required_boolean(const Value& object, std::string_view name, bool& output)
{
    const auto* value = member(object, name);
    if (value == nullptr || !value->is_boolean()) {
        return false;
    }
    output = value->get<bool>();
    return true;
}

bool optional_boolean(const Value& object, std::string_view name, bool& output)
{
    const auto* value = member(object, name);
    if (absent(value)) {
        return true;
    }
    if (!value->is_boolean()) {
        return false;
    }
    output = value->get<bool>();
    return true;
}

} // namespace crate::vdj::json
