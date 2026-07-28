package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CrateApplicationInstrumentedTest {
    @Test
    public void usesTheCrateApplicationId() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("app.cratemusic.crate", appContext.getPackageName());
    }
}
