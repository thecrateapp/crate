---
title: "Taking the library into VirtualDJ"
description: "Crate became a native VirtualDJ source. Host probes changed media tickets, search cancellation and how Smart Mix could feed the queue without mixing audio."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 32
related: [smart-mix-planned-on-the-server, giving-smart-mix-a-sense-of-musical-structure, from-crossfades-to-a-shared-mixing-engine]
tags: [How to dismantle Spotify, VirtualDJ, playback, history]
sources:
  - tools/vdj-plugin/src/sdk/online_source_plugin.cpp
  - tools/vdj-plugin/src/online_source/online_source.cpp
  - tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp
  - tools/vdj-plugin/src/core/connection_session.cpp
  - tools/vdj-plugin/src/client/capability_client.cpp
  - tools/vdj-plugin/src/client/stream_resolver.cpp
  - tools/vdj-plugin/src/client/media_access_client.cpp
  - tools/vdj-plugin/src/automix/play_events.cpp
  - tools/vdj-plugin/tests/online_source/online_source_test.cpp
  - app/crate/api/vdj_catalog.py
  - app/crate/media_access.py
  - app/tests/test_vdj_media_contract.py
  - app/tests/test_vdj_feature_gates.py
  - docs/technical/smart-mix-design.md
  - docs/technical/smart-mix-implementation-plan.md
---

_Part 32. A native VirtualDJ source, October to November 2026._

A DJ working in VirtualDJ needs the music in VirtualDJ's browser and on its decks. Opening Listen in
another window put Crate's library next to the host, not inside it: VirtualDJ had no searchable
tracks, no stable identities and no way to request audio when a track was loaded.

We built a native Online Source plugin. It would expose Crate's local catalogue, resolve media for
the host and bring Smart Mix suggestions into the existing workflow. VirtualDJ would keep its
player, deck controls, analysis and mixing engine. The integration had to fit the host's callbacks
and download behaviour, including some details we could only establish by running a probe inside
VirtualDJ.
[Initial native plugin](https://github.com/thecrateapp/crate/commit/f0820f924bd7cc0ec2e4ac9580846126c5cc60a4),
[implemented Online Source](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/sdk/online_source_plugin.cpp).

## Search in VirtualDJ, then leave before it finishes

VirtualDJ's Online Source SDK exposes search and folder callbacks, a list into which the plugin
adds track metadata, and `GetStreamUrl` for resolving a track when it is loaded. It also provides
login and context-menu hooks. This gave us a route into the existing browser without editing
VirtualDJ's internal database or building a second browser UI inside it.
[VirtualDJ Online Source SDK](https://virtualdj.com/wiki/Plugins_SDKv8_OnlineSource.html).

The SDK did not make the plugin a general replacement for Listen. Its folder interface has no
parent-folder argument and no paginated browser contract. Crate adapted its catalogue to one level
of folders, with bounded track lists and numbered parts for long playlists. Artist and album
context actions use search. Playlist visibility and recently played tracks are resolved for the
connected token owner, rather than exposing one server-wide personal history.
[Catalogue routes](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/api/vdj_catalog.py),
[folder queries and visibility](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/queries/vdj_catalog.py).

A C++20 core handles the Crate-specific work. The SDK adapter translates VirtualDJ callbacks into
that core's interfaces. For stream resolution, its job is small:

```cpp source="tools/vdj-plugin/src/sdk/online_source_plugin.cpp#L386-L401" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "source_.stream_url"
    HRESULT VDJ_API GetStreamUrl(
        const char* unique_id,
        IVdjString& url,
        IVdjString& error_message
    ) override
    {
        const auto result = source_.stream_url(unique_id == nullptr ? "" : unique_id);
        if (!result.url.has_value()) {
            url = "";
            error_message = result.error.c_str();
            return E_FAIL;
        }
        url = result.url->c_str();
        error_message = "";
        return S_OK;
    }
```

This split lets tests supply an HTTP client, credential store, track sink and host interface without
loading VirtualDJ. The private SDK remains a build dependency for the real plugin, rather than a
requirement for testing every HTTP error or cancellation race.
[Core and adapter separation](https://github.com/thecrateapp/crate/commit/69e479f58a83268facc16fa061ad545af196637d),
[SDK-independent integration tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/tests/online_source/online_source_test.cpp).

Track identity needed care too. The host represents a Crate track as
`netsearch://plugin-Crate/<entity_uid>`. Our host probe established that the prefix uses the bundle
file name, not merely the display name returned by `OnGetPluginInfo`. Renaming that bundle could
change the identity under which VirtualDJ stores its analysis, cues and history. We kept `Crate`
and the entity UID stable.
[Host findings and identity contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-design.md#61-what-the-sdk-and-the-host-allow).

### Search results could arrive after the user had left

A plugin runs inside someone else's process. A stalled request or a callback that writes into a
list the host has abandoned is more serious than an out-of-date search result on a web page.
VirtualDJ can cancel a search while the plugin is waiting for the server, or after the response
arrives but before the results have been published.

The current adapter runs search and folder work synchronously on the host's callback threads. It
does not add another search thread pool. Cancellation is coordinated with a generation number and
a cancellation token. Starting a new request cancels the previous generation. Before adding any
results to the host's list, the core checks that the request still owns the publication:

```cpp source="tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp#L24-L40" commit="69e479f58a83268facc16fa061ad545af196637d" "request.generation == generation_"
    template <typename Publish>
    bool publish(const Request& request, Publish&& publish)
    {
        std::lock_guard lock(mutex_);
        const auto found = in_flight_.find(request.generation);
        if (found == in_flight_.end()) {
            return false;
        }
        const bool current = !stopped_ && request.generation == generation_ &&
            !request.cancellation.cancelled();
        in_flight_.erase(found);
        if (!current) {
            return false;
        }
        publish();
        return true;
    }
```

The mutex also orders cancellation against publication already in progress. A request can publish
once; a superseded or cancelled one cannot later call `finish()` on the old list. Tests explicitly
cancel after the HTTP response, overlap two searches and verify that an abandoned list remains
untouched.
[Request coordinator tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/tests/online_source/request_coordinator_test.cpp),
[search lifecycle tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/tests/online_source/online_source_test.cpp).

Cancellation also reaches libcurl, so ignoring the response is not the only way to stop work. The
HTTP client restricts requests to the configured HTTPS origin, disables redirects and bounds the
response body. Stream resolution has an overall eight-second budget shared between playback
resolution and ticket issuance. These limits bound the work an unavailable server can leave running inside the host.
[HTTP transport](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/client/curl_http_client.cpp),
[stream deadline](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/client/stream_resolver.cpp).

## Load the track, then load the same URL again

The plugin connects to a specific Crate server with a personal access token. It verifies the
identity and capability contract before saving the token in macOS Keychain or Windows Credential
Manager. A saved origin tells it which server to restore; it does not put the token into the
settings file or metadata cache.
[Connection session](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/core/connection_session.cpp),
[platform credential stores](https://github.com/thecrateapp/crate/tree/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/auth).

The capability check distinguishes basic catalogue access from Smart Mix assistance and automation.
It checks contract and plugin versions, then combines server capabilities with the token's scopes.
An incompatible Smart Mix profile or planner can disable those features without necessarily
rejecting the basic Online Source contract.
[Capability negotiation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/core/contract_negotiator.cpp),
[effective token features](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/client/capability_client.cpp).

Crate API calls carry the token in an Authorization header. The host's audio downloader receives a
URL instead. The plugin first resolves the selected entity and checks that the response identifies
the requested, ready, local track. It then asks `/api/auth/media-access` for a ticket bound to that
exact stream path and returns the ticketed URL. The full account token never becomes part of the
host's audio URL.
[Playback validation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/client/stream_resolver.cpp),
[media-ticket client](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/client/media_access_client.cpp).

![The native plugin uses a scoped account token for catalogue and ranking requests, and obtains a path-bound media ticket. VirtualDJ fetches audio directly with that ticket. Crate can add ranked songs to the Automix queue; VirtualDJ retains the decks, transitions and output.](/blog/taking-the-library-into-virtualdj/host-and-media.svg)

### A media URL had to outlive its first download

Our normal media tickets lasted sixty seconds. That was a poor fit for what VirtualDJ actually did
with a resolved URL.

The probe on VirtualDJ 8.5.9307 Pro on macOS arm64 showed a full HTTP download when a track was
loaded, rather than the Range and HEAD pattern we might expect from a browser player. The host
could reuse the same URL for a later download without calling `GetStreamUrl` again. An expired
URL returning 401 could leave that track unusable for the rest of the host session. Returning a new
ticket from a callback did not help if the host never made the callback.
[Recorded host findings](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-design.md#61-what-the-sdk-and-the-host-allow),
[probe implementation](https://github.com/thecrateapp/crate/tree/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/probe).

We changed tickets tied to an access token to last twelve hours. Ordinary session tickets kept
their shorter lifetime. The issuer selects the lifetime from the credential type:

```python source="app/crate/media_access.py#L186-L197" commit="0ecfe5c2bc7aaf2af0f07a71eb55cf17d9a5b067" "ACCESS_TOKEN_MEDIA_TTL_SECONDS"
    ttl_seconds = (
        ACCESS_TOKEN_MEDIA_TTL_SECONDS
        if access_token_id is not None
        else MEDIA_ACCESS_TTL_SECONDS
    )
    _store(_ticket_key(ticket), payload, ttl_seconds)
    return IssuedMediaAccessTicket(
        ticket=ticket,
        audience=audience,
        path=normalized_path,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
    )
```

The longer lifetime makes the URL more useful to the host, and also means the URL must be treated
as a secret for longer. Its scope remains one media path. Each new request resolves the associated
access-token record and checks current authorization, so revoking the token or removing its media
scope invalidates subsequent access even while the ticket itself has time left. Tests cover a
second download, revocation before another range, a ticket for a different track and missing scope.
[Media authorization tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_vdj_media_contract.py).

That does not take audio back from VirtualDJ. Once the host has downloaded a track, it can keep
playing and seeking through those bytes while Crate is unreachable or the token is revoked. The
local host checks observed that behaviour. We can deny the next unauthorized request; we cannot
make a completed download disappear from the host's memory.
[Deck-media validation](https://github.com/thecrateapp/crate/commit/ab85c47fa63ae31c2dca4aaf5edad6009fe5ef2c).

Metadata has a separate cache. Its SQLite entries are scoped by origin and credential account key.
A transport failure or server error can fall back to stale metadata. A 401, 403, cancellation or
invalid response does not become a stale-cache success. Seeing a cached title is not evidence that
the plugin still has permission to load its audio.
[Metadata cache](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp),
[stale fallback rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/core/http_client.cpp).

## The host queues and mixes; Crate suggests and records

The compatible-tracks folder uses the server's ranking, with a currently loaded Crate track or an
explicit context-menu selection as its seed. It carries BPM, key and other available profile
metadata into the host's track fields and comments. This reuses the same analysis and ranking
covered in [the Smart Mix article](/blog/smart-mix-planned-on-the-server), while keeping the host's
own analysis and presentation intact.
[Compatible-track integration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/online_source/compatible_tracks.cpp).

Crate Automix extends that assistance by adding selected tracks to VirtualDJ's queue. VirtualDJ
already has an Automix engine with its own transition modes, mix points and user controls. The
plugin does not execute Crate's Android transition plan inside the host or send a stream of tempo,
EQ and crossfader commands.
[VirtualDJ Automix](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix.html),
[Crate Automix boundary](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-design.md#67-c-crate-automix).

The feeder waits for the host's Automix to be active, takes a Crate track as its starting point and
keeps a small lookahead, initially two queued tracks. It requests ranked candidates from the
server, excludes tracks already played or planned, and filters recent artists and albums. It then
asks the host to append a track, or put it next after a detected manual track change:

```cpp source="tools/vdj-plugin/src/online_source/online_source.cpp#L497-L512" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "host_.send_command"
void OnlineSource::enqueue_automix_addition()
{
    const auto addition = *automix_addition_;
    automix_addition_.reset();
    const std::string verb = addition.next ? "automix_add_next" : "playlist_add";
    const bool sent = host_.send_command(verb + " " + netsearch_path(addition.uid));
    log("automix " + verb + " id=" + addition.uid + (addition.navigated ? " listed" : "") +
        (sent ? "" : " failed"));
    if (sent) {
        if (addition.next) {
            automix_.planned.insert(automix_.planned.begin(), addition.uid);
        } else {
            automix_.planned.push_back(addition.uid);
        }
    }
}
```

Queue lookahead also controls downloading: adding a track can make VirtualDJ resolve and fetch it
before it reaches a deck. Filling a long queue is therefore a network decision as well as an
editorial one. The short lookahead lets the feeder respond to what is actually playing without
preloading a whole proposed set.

Host integration produced a less obvious problem with metadata. A track added by its `netsearch`
path needed to be listed in VirtualDJ so its queue row carried the expected information. The plugin
added a temporary Crate Automix folder for those selected tracks. It can visit that folder, let the
host see the rows, then restore the previous browser location before adding the song. It waits
around browser activity and avoids moving away from an open search. If the listing does not arrive
within the bounded wait, it can still queue the track.
[Listing tracks before queueing](https://github.com/thecrateapp/crate/commit/3ba584d80e92fd24ed9cf6f416a9def850996d3e),
[preserving an open search](https://github.com/thecrateapp/crate/commit/ba219d26437f1fc32cb45ced9d13035b800b2690).

This is also why the feeder does not claim ownership of the whole Automix queue. A DJ can add
tracks or choose a different one manually. The plugin observes the host, changes its next candidate
when necessary and leaves the actual mix under VirtualDJ's control. Turning off further feeding
does not undo a transition or remove audio the host already has.

### Plays needed a different definition on a deck

Loading a track, cueing it in headphones or briefly scratching through it should not all become
ordinary listens. The plugin polls deck state, including the host's `is_audible` result, and
accumulates audible time separately from the position inside the song.

Its current threshold is thirty audible seconds. A track observed near completion can qualify
with at least two audible seconds; the completion check uses a five-second end margin. These are
explicit heuristics, not a measurement of what reached every possible external mixer. Events wait
in a bounded local spool when the API cannot accept them and are sent with a stable event ID for
deduplication.
[Play tracking and delivery](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/automix/play_events.cpp),
[play-event tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/tests/automix/play_events_test.cpp).

## The host sessions we had tested

The server's VirtualDJ and automation flags are off by default. A token needs the appropriate
catalogue, media and Smart Mix scopes; automation additionally requires `vdj.automation.execute`.
The legacy `vdj.automation` name does not silently grant that permission. The current worker also
requires play-event capability before its deck-polling and feeder loop runs. Its feature decisions
come from the checked connection state, which is refreshed periodically; this is not an
instantaneous remote cancellation mechanism for commands already accepted by the host.
[Default flags](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/config.py),
[scope and feature-gate tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_vdj_feature_gates.py),
[worker checks](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/src/online_source/online_source.cpp).

The native packages target macOS arm64, macOS x86_64 and Windows x64. Packaging checks the binary
shape and dependencies, and records tested VirtualDJ versions separately. Windows links its
supporting libraries statically; macOS bundles are signed ad hoc. These are internal-test packages,
without macOS notarization or Windows Authenticode signing. A package built for an architecture is
not proof that it has passed the host acceptance session there.
[Package workflow](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/.github/workflows/vdj-plugin-release.yml),
[package validation](https://github.com/thecrateapp/crate/tree/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/vdj-plugin/packaging).

The recorded macOS host checks cover search, folders, two-deck media loading, recovery, play events
and a short Automix run. The implementation plan still distinguishes those checks from a long
Automix acceptance session and a joint release. Integrated OAuth, an encrypted audio cache and
Crate radio as an Automix source remain outside this implementation. The separate Crate Decks
server contract is not a finished standalone DJ application either.
[Host evidence and outstanding acceptance work](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-implementation-plan.md),
[Crate Decks contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-decks.md).
