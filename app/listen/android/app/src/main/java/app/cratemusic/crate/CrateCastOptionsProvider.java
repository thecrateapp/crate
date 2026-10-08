package app.cratemusic.crate;

import android.content.Context;

import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;

import java.util.List;

public class CrateCastOptionsProvider implements OptionsProvider {
    @Override
    public CastOptions getCastOptions(Context context) {
        return new CastOptions.Builder()
            .setReceiverApplicationId(context.getString(R.string.crate_cast_receiver_app_id))
            .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}
