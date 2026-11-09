---
title: "Keeping the music playing when Android puts the screen to sleep"
description: "Android needed to own the audio and queue while Listen slept. Moving playback into Media3 also changed how the app reconnects and restores a lost session."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 14
related: [taking-crate-out-of-the-browser, smart-mix-planned-on-the-server, taking-playback-over-from-navidrome]
tags: [How to dismantle Spotify, Android, playback, history]
sources:
  - app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackPlugin.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/PlaybackCheckpointStore.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/ResumeAuthorizationIntent.java
  - app/listen/android/app/src/test/java/app/cratemusic/crate/PlaybackCheckpointStoreTest.java
  - app/listen/android/app/src/test/java/app/cratemusic/crate/NativePlaybackContractTest.java
  - app/listen/src/lib/android-native-engine.ts
  - app/listen/src/contexts/use-native-playback-event-bridge.ts
  - docs/technical/android-playback-resumption.md
---

_Part 14. Giving Android ownership of playback, May 2026, and recovering sessions after process loss._

Pressing Next in Crate's Android notification did not reach a native player. A native service owned
the notification and audio focus, but the sound came from the web player inside Listen's WebView.

That left a dependency in the middle of every transport command. The native service broadcast the
action, the Capacitor bridge delivered it to JavaScript, and the web player changed the audio. Giving
the notification a longer life did not give the queue or the player a longer life. If the WebView
could not run the work, the native controls could not complete it on their own.
[The original notification service](https://github.com/thecrateapp/crate/blob/50aff9d2613cf8167bf4aa123eddf6cdc0c636c1/app/listen/android/app/src/main/java/app/cratemusic/crate/CratePlaybackService.java).

The [first mobile shell](/blog/taking-crate-out-of-the-browser) had let us reuse Listen's interface.
For background playback, we needed to move the audio and the loaded queue out of that interface.
Android would run them in a Media3 service, and React would send commands and display the resulting
state. Closing or suspending the interface would no longer remove the component advancing the music.

## While the process is alive

The old service was doing useful work. It published track metadata, acquired wake and Wi-Fi locks,
handled focus changes and exposed Android media controls. Keeping that service while improving the
JavaScript bridge was a smaller change than replacing the player. It also retained the same dependency:
the bridge had to reach a functioning WebView to execute the action.

Android's Media3 model puts a `Player` and `MediaSession` inside a `MediaSessionService`. The interface
connects as a controller, while the service owns playback and can continue when the activity is no
longer visible. Media3 also manages the media notification from the session. This is the platform
model our native engine adopted; the Android documentation explains why the player belongs outside
the activity when playback must continue in the background.
[Media3 background playback](https://developer.android.com/media/media3/session/background-playback).

We kept Listen's React screens and introduced a `PlaybackEngine` interface with web and Android
implementations. The factory selected the Android adapter when its native-player preference allowed
it; otherwise it created the existing web engine. The first version also fell back to the web player
when crossfade was enabled. Moving ordinary playback first did not mean the native engine already
implemented every behaviour of the web player.
[Engine selection](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/src/lib/playback-engine-factory.ts),
[initial native-player conditions](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/src/lib/android-native-engine.ts#L59-L71).

This split also meant we had to silence the engine we were leaving. The synchronization code paused,
stopped and cleared the web queue when native playback took over, and could stop the native engine
when switching back. Two implementations behind an interface are still two possible audio producers.
[Engine handoff](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/src/contexts/use-player-engine-sync.ts).

### Give ExoPlayer the queue, then detach the interface

`CrateNativePlaybackService` created an ExoPlayer and bound it to a Media3 session. Its initial setup
enabled a local wake lock, declared music playback and delegated audio-focus handling to ExoPlayer:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L137-L147" commit="e7380245bb62dca1a038de0002705c0769909a59" "setAudioAttributes"
        player = buildPlayer();
        assignStableAudioSessionId();
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true
        );
        player.setHandleAudioBecomingNoisy(true);
```

The `true` argument asks ExoPlayer to manage focus. Android recommends this arrangement when using
ExoPlayer, so an application does not also need a competing focus manager. Handling audio becoming
noisy covers another ordinary interruption: a private output disappearing should not unexpectedly
send the music through the phone's speaker.
[Android audio-focus guidance](https://developer.android.com/media/optimize/audio-focus),
[ExoPlayer's noisy-audio handling](https://developer.android.com/reference/androidx/media3/exoplayer/ExoPlayer.Builder#setHandleAudioBecomingNoisy(boolean)).

React supplied a queue snapshot with a revision, resolved tracks, starting index, position, repeat
mode and autoplay intent. The service turned those tracks into Media3 `MediaItem`s, loaded the
playlist into ExoPlayer and prepared it. Advancing through that loaded playlist no longer required
JavaScript to notice an ended event and start the next URL.
[Initial queue loading](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L444-L494).

Queue edits crossed the same boundary. An append included the revision of the queue it belonged to:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L497-L505" commit="e7380245bb62dca1a038de0002705c0769909a59" "isCurrentRevision"
    public void appendTracks(String revision, List<NativeTrack> tracks) {
        if (!isCurrentRevision(revision)) return;
        if (player == null || tracks == null || tracks.isEmpty()) return;
        for (NativeTrack track : tracks) {
            if (track.url.isEmpty()) continue;
            queue.add(track);
            player.addMediaItem(toMediaItem(track));
        }
        refreshMediaSessionControls();
```

Suppose the listener started an album while a request to extend the previous radio queue was still
running. A result carrying the old revision should not append radio tracks to the album. The first
implementation rejected a different nonempty revision, although it still accepted an omitted
revision for compatibility. The revision was a queue-consistency check, not authentication, and its
early permissiveness matters when reading that code.
[Initial revision check](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L697-L705).

![The original native controls sent commands through the WebView to web audio. The new Media3 service owns the queue and audio; the WebView can detach. After process loss, a safe checkpoint must obtain fresh authorization before playback can resume.](/blog/keeping-the-music-playing-on-android/playback-ownership.svg)

### Disconnecting the interface must not stop the music

The Capacitor plugin bound to the service and attached an event sink. When the bridge was destroyed,
it removed that sink and unbound. It did not call `stop()` on the player:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackPlugin.java#L267-L278" commit="e7380245bb62dca1a038de0002705c0769909a59" "setEventSink(null)"
    protected void handleOnDestroy() {
        if (service != null) {
            service.setEventSink(null);
        }
        try {
            getContext().unbindService(connection);
        } catch (IllegalArgumentException ignored) {
            // The service may not have been bound if the bridge is torn down early.
        }
        service = null;
        binding = false;
        super.handleOnDestroy();
```

The service's task-removal policy made the same distinction. It stopped an empty, ended or paused
player when the task was removed. It left an active player running. Releasing ExoPlayer and the media
session belonged to service destruction, a separate lifecycle event.
[Task removal and service cleanup](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L382-L409).

The UI then needed to catch up with a player that might have moved on without it. Native events
included the queue revision and a native timestamp. While no event sink was attached, the service
kept a bounded event buffer and replaced the previous position update with the latest one. Replaying
every old position would waste work and make the progress bar walk through time the listener had
already heard.
[Initial event buffering](https://github.com/thecrateapp/crate/blob/e7380245bb62dca1a038de0002705c0769909a59/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L665-L705).

Reconnection later needed explicit event ordering too. A freshly delivered event and an older
buffered event can arrive close together. The current bridge uses native sequence numbers to reject
stale events, with timestamp handling for older shells. The screen follows the service's current
track and position instead of assuming that the last React state is still correct.
[Current native-event reconciliation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/use-native-playback-reconciliation.ts).

Screen lock, removing a task, losing a process and explicitly stopping the application are different
events. The first two can leave an active service running. Process loss requires restoration.
Force-stop ends the application; a foreground service is not an exemption. Android's Active apps
Stop action also removes the entire app from memory and stops its media playback, without a cleanup
callback. We cannot promise uninterrupted sound through an explicit stop by the listener.
[Android's user-initiated stopping behaviour](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping).

## After the process is gone

A service can outlive the activity that controls it. It still lives in an Android process. If that
process disappears, the ExoPlayer instance and its in-memory queue disappear with it. We needed a
way to reconstruct the session without treating a saved stream URL as permanent permission to play.

In July we added a small native checkpoint. It stored queue revision, track identities and display
metadata, index, position, repeat mode and prior playback intent. It deliberately omitted stream
URLs and authorization headers. Artwork URLs lost their query strings before serialization, so a
ticket in an image URL did not become part of the durable checkpoint.
[Checkpoint format](https://github.com/thecrateapp/crate/blob/3ff83ed887c3778bc033545d15c3abd3e1151b2f/app/listen/android/app/src/main/java/app/cratemusic/crate/PlaybackCheckpointStore.java).

That data could reconstruct the visible media session, but it could not reconstruct an authenticated
stream. Restored tracks used a placeholder URI such as `crate-resume://pending/track-id`. Supplying
that URI let Media3 retain an item with metadata without supplying a stale remote address. The
service marked the restored queue as authorization-pending.
[Placeholder media item](https://github.com/thecrateapp/crate/blob/42892de3d588e8698ba57f8036f9382877cdacdd/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L943-L953),
[restoring metadata and cursor](https://github.com/thecrateapp/crate/blob/42892de3d588e8698ba57f8036f9382877cdacdd/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L423-L450).

The first recovery guard intercepted play and prepare requests from media controllers:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L289-L306" commit="42892de3d588e8698ba57f8036f9382877cdacdd" "ERROR_SESSION_AUTHENTICATION_EXPIRED"
                public int onPlayerCommandRequest(
                    MediaSession session,
                    MediaSession.ControllerInfo controller,
                    int playerCommand
                ) {
                    if (
                        resumeAuthorizationPending &&
                        (
                            playerCommand == Player.COMMAND_PLAY_PAUSE ||
                            playerCommand == Player.COMMAND_PREPARE
                        )
                    ) {
                        emitResumeAuthorizationRequired();
                        openAppForAuthorization();
                        return SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED;
                    }
                    return SessionResult.RESULT_SUCCESS;
                }
```

Pressing Play asked the application to renew authorization instead of making the player repeatedly
open an unusable URL. React rebuilt the native queue from its logical queue and authenticated media
access. Until that succeeded, the restored session remained paused. The checkpoint recovered the queue and cursor. Fresh authorization was still needed to play it.
[Playback resumption contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/android-playback-resumption.md).

Recovery introduced a startup race of its own. The native service could request authorization as soon
as the UI attached, before React had rehydrated its saved queue. An immediate recovery attempt could
return `false` because there was no queue to rebuild yet. The current bridge makes a bounded sequence
of attempts while state catches up. It also tracks the recovery intent, so a later action or a disposed
bridge can cancel the old attempt instead of letting it restart unwanted playback.
[Recovery retries and intent cancellation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/use-native-playback-event-bridge.ts).

We also had to preserve what the listener requested while authorization was pending. The current
`ResumeAuthorizationIntent` carries deferred seek and navigation, as well as whether playback should
start. A saved position is useful only if recovery does not overwrite a more recent Next, Seek or
Pause. Failed authorization leaves the session paused and reports the recovery failure; it does not
turn an old stored URL into a fallback credential.
[Deferred playback intent](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/android/app/src/main/java/app/cratemusic/crate/ResumeAuthorizationIntent.java),
[intent tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/android/app/src/test/java/app/cratemusic/crate/ResumeAuthorizationIntentTest.java).

The automated checks cover checkpoint and bridge contracts: checkpoint serialization excludes media
credentials, deferred navigation stays within the restored queue, native authorization stays scoped
to its origin, and event coalescing preserves ordering. Focus interruptions, headset changes and manufacturers stopping background work still need
physical-device checks.
[Checkpoint test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/android/app/src/test/java/app/cratemusic/crate/PlaybackCheckpointStoreTest.java),
[native playback contract tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/android/app/src/test/java/app/cratemusic/crate/NativePlaybackContractTest.java).

Native playback still needs valid network authorization. The current HTTP path scopes supplied
credentials to explicit HTTPS origins, with separate stream and artwork mappings; an unrelated
external URL does not inherit Crate's bearer token. This matters because the service now makes its
own requests, outside the web API client's header handling. It also keeps the checkpoint's role
narrow: durable metadata is not a durable authorization grant.
[Native authorization contract tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/android/app/src/test/java/app/cratemusic/crate/NativePlaybackContractTest.java).

## A loaded queue can still run out

Moving a loaded queue into the service solved its dependency on JavaScript for ordinary advancement.
An endless radio session introduced another dependency: somebody still had to request more tracks.
Later work moved continuation into the native runtime too, so exhausting the loaded queue did not
require a sleeping WebView to refill it. Smart Mix added native transition execution behind the same
media session. Those are further pieces of playback ownership, covered separately from this first
engine in [the Smart Mix article](/blog/smart-mix-planned-on-the-server) and the continuation work.
[Native continuation implementation](https://github.com/thecrateapp/crate/commit/571ce336f489ae0f3565a38680bd276725af5cbb),
[current continuation contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/playback-continuation.md).
