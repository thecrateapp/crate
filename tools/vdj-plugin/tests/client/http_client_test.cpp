#include "crate_vdj/http_client.hpp"
#include "crate_vdj/models.hpp"

#include <cassert>
#include <chrono>
#include <string>

using namespace crate::vdj;

int main()
{
    assert(is_allowed_origin(
        "https://api.crate.example/api/capabilities",
        "https://api.crate.example"
    ));
    assert(is_allowed_origin(
        "https://api.crate.example:8443/api",
        "https://api.crate.example:8443"
    ));
    assert(!is_allowed_origin(
        "http://api.crate.example/api",
        "https://api.crate.example"
    ));
    assert(!is_allowed_origin(
        "https://api.crate.example.attacker/api",
        "https://api.crate.example"
    ));
    assert(!is_allowed_origin(
        "https://api.crate.example:9443/api",
        "https://api.crate.example"
    ));

    CancellationSource cancellation;
    assert(!cancellation.token().cancelled());
    cancellation.cancel();
    assert(cancellation.token().cancelled());

    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::seconds(1);
    assert(should_abort(cancellation.token(), deadline));

    CancellationSource active;
    assert(!should_abort(active.token(), deadline));
    assert(should_abort(
        active.token(),
        std::chrono::steady_clock::now() - std::chrono::milliseconds(1)
    ));

    const auto timeout = normalize_http_failure(
        HttpFailure{HttpFailureCode::Timeout, 0, "upstream timeout"}
    );
    assert(timeout.code == HttpErrorCode::Timeout);
    assert(timeout.message == "upstream timeout");

    const auto response_error = normalize_http_failure(
        HttpFailure{HttpFailureCode::HttpStatus, 502, "bad gateway"}
    );
    assert(response_error.code == HttpErrorCode::HttpStatus);
    assert(response_error.status_code == 502);

    const auto parsed = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 1,
          "planner_version": "smart-mix-v1",
          "online_source": true,
          "smart_mix_assistant": true,
          "automation": false,
          "future_field": {"nested": ["value", true]}
        }
    )json");
    assert(parsed.ok());
    assert(parsed.value->planner_version == "smart-mix-v1");
    assert(parsed.value->online_source);
    assert(!parsed.value->automation);

    const auto wrong_schema = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 2,
          "planner_version": "smart-mix-v1",
          "online_source": false,
          "smart_mix_assistant": false,
          "automation": false
        }
    )json");
    assert(!wrong_schema.ok());
    assert(wrong_schema.error_code == ModelErrorCode::UnsupportedSchema);

    const auto missing_field = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 1,
          "planner_version": "smart-mix-v1",
          "online_source": false,
          "smart_mix_assistant": false
        }
    )json");
    assert(!missing_field.ok());
    assert(missing_field.error_code == ModelErrorCode::MissingField);

    const auto api_response = parse_capabilities_json(R"json(
        {
          "smart_mix": {"available": true},
          "vdj": {
            "available": true,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v1",
            "online_source": true,
            "smart_mix_assistant": true,
            "automation": false
          }
        }
    )json");
    assert(api_response.ok());
    assert(api_response.value->min_plugin_version == "1.0.0");
    assert(api_response.value->max_plugin_version == "1.x");

    CurlHttpClient http;
    const auto invalid_origin = http.request(HttpRequest{
        .url = "https://api.example.test/api/search",
        .allowed_origin = "https://other.example.test",
    });
    assert(std::holds_alternative<HttpError>(invalid_origin));
    assert(
        std::get<HttpError>(invalid_origin).code ==
        HttpErrorCode::InvalidResponse
    );
}
