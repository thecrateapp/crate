#pragma once

#include "crate_vdj/models.hpp"

#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj::json {

using Value = nlohmann::json;

struct Limits {
    std::size_t max_body_bytes = 2 * 1024 * 1024;
    std::size_t max_depth = 32;
    std::size_t max_collection_items = 10'000;
};

inline constexpr Limits kDefaultLimits{};

ParseResult<Value> parse_bounded(
    std::string_view body,
    const Limits& limits = kDefaultLimits
);

ParseResult<Value> parse_object(
    std::string_view body,
    const Limits& limits = kDefaultLimits
);

const Value* member(const Value& object, std::string_view name);

bool required_string(const Value& object, std::string_view name, std::string& output);
bool optional_string(const Value& object, std::string_view name, std::string& output);
bool optional_string(
    const Value& object,
    std::string_view name,
    std::optional<std::string>& output
);

bool required_integer(
    const Value& object,
    std::string_view name,
    std::int64_t& output,
    std::int64_t minimum = std::numeric_limits<std::int64_t>::min(),
    std::int64_t maximum = std::numeric_limits<std::int64_t>::max()
);
bool optional_integer(
    const Value& object,
    std::string_view name,
    std::optional<std::int64_t>& output,
    std::int64_t minimum = std::numeric_limits<std::int64_t>::min(),
    std::int64_t maximum = std::numeric_limits<std::int64_t>::max()
);

bool required_number(const Value& object, std::string_view name, double& output);
bool optional_number(
    const Value& object,
    std::string_view name,
    std::optional<double>& output
);
bool optional_number(const Value& object, std::string_view name, double& output);

bool required_boolean(const Value& object, std::string_view name, bool& output);
bool optional_boolean(const Value& object, std::string_view name, bool& output);

template <typename T>
ParseResult<T> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<T>{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
    };
}

template <typename T>
ParseResult<T> success(T value)
{
    return ParseResult<T>{
        .value = std::move(value),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace crate::vdj::json
