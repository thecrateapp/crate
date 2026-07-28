package app.cratemusic.crate;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CrateSecureSessionPluginTest {
    @Test
    public void validatesOnlyCrateSecureNamespaces() {
        assertTrue(CrateSecureSessionPlugin.isValidKey("crate.session.server-1"));
        assertTrue(CrateSecureSessionPlugin.isValidKey("crate.oauth.state_token"));
        assertFalse(CrateSecureSessionPlugin.isValidKey("server-1"));
        assertFalse(CrateSecureSessionPlugin.isValidKey("crate.session."));
        assertFalse(CrateSecureSessionPlugin.isValidKey("crate.session.one/other"));
    }

    @Test
    public void validatesOnlyBoundedPrefixes() {
        assertTrue(CrateSecureSessionPlugin.isValidPrefix("crate.session."));
        assertTrue(CrateSecureSessionPlugin.isValidPrefix("crate.oauth."));
        assertFalse(CrateSecureSessionPlugin.isValidPrefix("crate."));
        assertFalse(CrateSecureSessionPlugin.isValidPrefix(""));
    }
}
