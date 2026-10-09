#include "crate_vdj/http_client.hpp"
#include "crate_vdj/models.hpp"

#include "../support/check.hpp"
#include <chrono>
#include <string>

using namespace crate::vdj;

int main()
{
    CRATE_CHECK(is_allowed_origin(
        "https://api.crate.example/api/capabilities",
        "https://api.crate.example"
    ));
    CRATE_CHECK(is_allowed_origin(
        "https://api.crate.example:8443/api",
        "https://api.crate.example:8443"
    ));
    CRATE_CHECK(!is_allowed_origin(
        "http://api.crate.example/api",
        "https://api.crate.example"
    ));
    CRATE_CHECK(!is_allowed_origin(
        "https://api.crate.example.attacker/api",
        "https://api.crate.example"
    ));
    CRATE_CHECK(!is_allowed_origin(
        "https://api.crate.example:9443/api",
        "https://api.crate.example"
    ));

    CancellationSource cancellation;
    CRATE_CHECK(!cancellation.token().cancelled());
    cancellation.cancel();
    CRATE_CHECK(cancellation.token().cancelled());

    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::seconds(1);
    CRATE_CHECK(should_abort(cancellation.token(), deadline));

    CancellationSource active;
    CRATE_CHECK(!should_abort(active.token(), deadline));
    CRATE_CHECK(should_abort(
        active.token(),
        std::chrono::steady_clock::now() - std::chrono::milliseconds(1)
    ));

    const auto timeout = normalize_http_failure(
        HttpFailure{HttpFailureCode::Timeout, 0, "upstream timeout"}
    );
    CRATE_CHECK(timeout.code == HttpErrorCode::Timeout);
    CRATE_CHECK(timeout.message == "upstream timeout");

    const auto response_error = normalize_http_failure(
        HttpFailure{HttpFailureCode::HttpStatus, 502, "bad gateway"}
    );
    CRATE_CHECK(response_error.code == HttpErrorCode::HttpStatus);
    CRATE_CHECK(response_error.status_code == 502);

    const auto parsed = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 1,
          "planner_version": "smart-mix-v2",
          "online_source": true,
          "smart_mix_assistant": true,
          "automation": false,
          "future_field": {"nested": ["value", true]}
        }
    )json");
    CRATE_CHECK(parsed.ok());
    CRATE_CHECK(parsed.value->planner_version == "smart-mix-v2");
    CRATE_CHECK(parsed.value->online_source);
    CRATE_CHECK(!parsed.value->automation);

    const auto wrong_schema = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 2,
          "planner_version": "smart-mix-v2",
          "online_source": false,
          "smart_mix_assistant": false,
          "automation": false
        }
    )json");
    CRATE_CHECK(!wrong_schema.ok());
    CRATE_CHECK(wrong_schema.error_code == ModelErrorCode::UnsupportedSchema);

    const auto missing_field = parse_capabilities_json(R"json(
        {
          "contract_version": "2026-08",
          "profile_schema_version": 1,
          "planner_version": "smart-mix-v2",
          "online_source": false,
          "smart_mix_assistant": false
        }
    )json");
    CRATE_CHECK(!missing_field.ok());
    CRATE_CHECK(missing_field.error_code == ModelErrorCode::MissingField);

    const auto api_response = parse_capabilities_json(R"json(
        {
          "smart_mix": {"available": true},
          "vdj": {
            "available": true,
            "min_plugin_version": "1.0.0",
            "max_plugin_version": "1.x",
            "contract_version": "2026-08",
            "profile_schema_version": 1,
            "planner_version": "smart-mix-v2",
            "online_source": true,
            "smart_mix_assistant": true,
            "automation": false
          }
        }
    )json");
    CRATE_CHECK(api_response.ok());
    CRATE_CHECK(api_response.value->min_plugin_version == "1.0.0");
    CRATE_CHECK(api_response.value->max_plugin_version == "1.x");

    CurlHttpClient http;
    const auto invalid_origin = http.request(HttpRequest{
        .url = "https://api.example.test/api/search",
        .allowed_origin = "https://other.example.test",
    });
    CRATE_CHECK(std::holds_alternative<HttpError>(invalid_origin));
    CRATE_CHECK(
        std::get<HttpError>(invalid_origin).code ==
        HttpErrorCode::InvalidResponse
    );

    CancellationSource cancelled_before;
    cancelled_before.cancel();
    const auto not_sent = http.request(HttpRequest{
        .url = "https://api.example.test/api/search",
        .allowed_origin = "https://api.example.test",
        .cancellation = cancelled_before.token(),
    });
    CRATE_CHECK(std::holds_alternative<HttpError>(not_sent));
    CRATE_CHECK(std::get<HttpError>(not_sent).code == HttpErrorCode::Cancelled);

    std::string body;
    CRATE_CHECK(append_bounded_body(body, "abc", 5));
    CRATE_CHECK(append_bounded_body(body, "de", 5));
    CRATE_CHECK(!append_bounded_body(body, "f", 5));
    CRATE_CHECK(body == "abcde");

    const auto insecure = http.request(HttpRequest{
        .url = "http://api.example.test/api/search",
        .allowed_origin = "http://api.example.test",
    });
    CRATE_CHECK(std::holds_alternative<HttpError>(insecure));
}
