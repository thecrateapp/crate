#include "crate_vdj/credential_store.hpp"

#include "../support/check.hpp"
#include <optional>
#include <string>

using namespace crate::vdj;

namespace {

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return token_;
    }

    void save_token(std::string token) override
    {
        token_ = std::move(token);
    }

    void clear_token() override
    {
        token_.reset();
    }

private:
    std::optional<std::string> token_;
};

} // namespace

int main()
{
    MemoryCredentialStore store;
    CRATE_CHECK(!store.load_token().has_value());
    store.save_token("crv_test-only-token");
    CRATE_CHECK(store.load_token() == "crv_test-only-token");
    store.clear_token();
    CRATE_CHECK(!store.load_token().has_value());
}
