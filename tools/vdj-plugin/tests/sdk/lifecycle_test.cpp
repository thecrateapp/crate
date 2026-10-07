#include "mock_virtualdj.hpp"

#include <cassert>
#include <chrono>
#include <thread>

using namespace crate::vdj;
using namespace crate::vdj::test;

int main()
{
    MockVirtualDJ vdj;
    assert(vdj.send_command("deck 1 play").ok);
    assert(vdj.send_command("deck 1 sync").ok);
    assert(vdj.command_count() == 2);
    assert(vdj.last_command() == "deck 1 sync");

    const auto state = vdj.read_state(1);
    assert(state.has_value());
    assert(state->deck == 1);
    assert(state->bpm == 128.0);
    assert(!vdj.read_state(2).has_value());

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
    assert(callback_count == 0);

    CompletionOnce completion;
    assert(completion.try_complete());
    assert(!completion.try_complete());
}
