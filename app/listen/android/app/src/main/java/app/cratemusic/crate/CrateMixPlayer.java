package app.cratemusic.crate;

import androidx.media3.common.ForwardingSimpleBasePlayer;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

@UnstableApi
final class CrateMixPlayer extends ForwardingSimpleBasePlayer {
    interface CommandInterceptor {
        default boolean beforePlay() {
            return true;
        }

        default void beforePause() {}

        default void beforeStop() {}

        default void beforeSeek(
            int mediaItemIndex,
            long positionMs,
            int seekCommand
        ) {}

        default void beforeRepeatModeChange(int repeatMode) {}
    }

    private static final CommandInterceptor NOOP_INTERCEPTOR =
        new CommandInterceptor() {};

    private Player activePlayer;
    private final CommandInterceptor commandInterceptor;

    CrateMixPlayer(Player initialPlayer) {
        this(initialPlayer, NOOP_INTERCEPTOR);
    }

    CrateMixPlayer(
        Player initialPlayer,
        CommandInterceptor commandInterceptor
    ) {
        super(initialPlayer);
        activePlayer = initialPlayer;
        this.commandInterceptor = commandInterceptor == null
            ? NOOP_INTERCEPTOR
            : commandInterceptor;
    }

    void promote(Player nextPlayer) {
        if (nextPlayer == null) {
            throw new IllegalArgumentException("Active player is required");
        }
        if (activePlayer == nextPlayer) {
            return;
        }
        setPlayer(nextPlayer);
        activePlayer = nextPlayer;
    }

    Player activePlayer() {
        return activePlayer;
    }

    @Override
    protected ListenableFuture<?> handleSetPlayWhenReady(
        boolean playWhenReady
    ) {
        if (playWhenReady && !commandInterceptor.beforePlay()) {
            return Futures.immediateVoidFuture();
        }
        if (!playWhenReady) {
            commandInterceptor.beforePause();
        }
        return super.handleSetPlayWhenReady(playWhenReady);
    }

    @Override
    protected ListenableFuture<?> handleStop() {
        commandInterceptor.beforeStop();
        return super.handleStop();
    }

    @Override
    protected ListenableFuture<?> handleSeek(
        int mediaItemIndex,
        long positionMs,
        int seekCommand
    ) {
        commandInterceptor.beforeSeek(
            mediaItemIndex,
            positionMs,
            seekCommand
        );
        return super.handleSeek(mediaItemIndex, positionMs, seekCommand);
    }

    @Override
    protected ListenableFuture<?> handleSetRepeatMode(int repeatMode) {
        commandInterceptor.beforeRepeatModeChange(repeatMode);
        return super.handleSetRepeatMode(repeatMode);
    }
}
