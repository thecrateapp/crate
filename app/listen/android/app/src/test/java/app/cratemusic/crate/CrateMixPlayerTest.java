package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.ForwardingSimpleBasePlayer;
import androidx.media3.common.Player;

import java.lang.reflect.Field;
import java.util.Arrays;

import org.junit.Test;

public class CrateMixPlayerTest {
    @Test
    public void exposesOneStableForwardingPlayer() throws Exception {
        assertTrue(
            ForwardingSimpleBasePlayer.class.isAssignableFrom(
                CrateMixPlayer.class
            )
        );
        assertNotNull(
            CrateMixPlayer.class.getDeclaredMethod(
                "promote",
                Player.class
            )
        );

        long playerFields = Arrays.stream(
            CrateMixPlayer.class.getDeclaredFields()
        )
            .map(Field::getType)
            .filter(Player.class::equals)
            .count();

        assertEquals(1L, playerFields);
    }
}
