package app.cratemusic.crate;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;

import org.junit.Test;

public class OfflineAssetVerifierTest {
    @Test
    public void validatesExpectedSizeAndRejectsTraversal() throws Exception {
        File root = Files.createTempDirectory("crate-offline").toFile();
        File asset = new File(root, "offline-media/track.m4a");
        assertTrue(asset.getParentFile().mkdirs());
        Files.write(asset.toPath(), new byte[] { 1, 2, 3 });

        assertTrue(
            OfflineAssetVerifier.verify(root, "offline-media/track.m4a", 3).valid
        );
        assertFalse(
            OfflineAssetVerifier.verify(root, "../outside.m4a", 0).valid
        );
    }

    @Test
    public void removesAnIntegrityMismatch() throws Exception {
        File root = Files.createTempDirectory("crate-offline").toFile();
        File asset = new File(root, "offline-media/track.m4a");
        assertTrue(asset.getParentFile().mkdirs());
        Files.write(asset.toPath(), new byte[] { 1, 2, 3 });

        assertFalse(
            OfflineAssetVerifier.verify(root, "offline-media/track.m4a", 4).valid
        );
        assertFalse(asset.exists());
    }

    @Test
    public void removesAZeroByteAssetEvenWithNoExpectedSize() throws Exception {
        File root = Files.createTempDirectory("crate-offline").toFile();
        File asset = new File(root, "offline-media/track.m4a");
        assertTrue(asset.getParentFile().mkdirs());
        Files.write(asset.toPath(), new byte[0]);

        assertFalse(
            OfflineAssetVerifier.verify(root, "offline-media/track.m4a", 0).valid
        );
        assertFalse(asset.exists());

        File asset2 = new File(root, "offline-media/track2.m4a");
        Files.write(asset2.toPath(), new byte[0]);
        assertFalse(
            OfflineAssetVerifier.verify(root, "offline-media/track2.m4a", 3).valid
        );
        assertFalse(asset2.exists());
    }
}
