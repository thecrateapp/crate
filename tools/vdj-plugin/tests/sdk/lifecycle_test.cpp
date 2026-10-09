#include "mock_virtualdj.hpp"

#include "../support/check.hpp"
#include <chrono>
#include <thread>

using namespace crate::vdj;
using namespace crate::vdj::test;

int main()
{
    MockVirtualDJ vdj;
    CRATE_CHECK(vdj.send_command("deck 1 play").ok);
    CRATE_CHECK(vdj.send_command("deck 1 sync").ok);
    CRATE_CHECK(vdj.command_count() == 2);
    CRATE_CHECK(vdj.last_command() == "deck 1 sync");

    const auto state = vdj.read_state(1);
    CRATE_CHECK(state.has_value());
    CRATE_CHECK(state->deck == 1);
    CRATE_CHECK(state->bpm == 128.0);
    CRATE_CHECK(!vdj.read_state(2).has_value());

    int callback_count = 0;
    {
        InFlightCapabilityClient client;
        CancellationSource cancellation;
        client.fetch(
            cancellation.token(),
            [&callback_count](CapabilityResult) { ++callback_count; }
        );
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    CRATE_CHECK(callback_count == 0);

    CompletionOnce completion;
    CRATE_CHECK(completion.try_complete());
    CRATE_CHECK(!completion.try_complete());
}
