package app.cratemusic.crate;

final class NativeDeckErrorRouter {
    interface Resolver {
        boolean resolve(NativePlaybackDeck deck);
    }

    private final Resolver resolver;
    private Object lastRoutedError;

    NativeDeckErrorRouter(Resolver resolver) {
        this.resolver = resolver;
    }

    boolean onFacadeError(Object error, NativePlaybackDeck activeDeck) {
        lastRoutedError = error;
        return resolver.resolve(activeDeck);
    }

    void onPhysicalDeckError(Object error, NativePlaybackDeck deck, boolean isActiveDeck) {
        if (isActiveDeck || error == lastRoutedError) {
            return;
        }
        lastRoutedError = error;
        resolver.resolve(deck);
    }
}
