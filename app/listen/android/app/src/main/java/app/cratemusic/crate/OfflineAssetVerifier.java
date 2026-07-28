package app.cratemusic.crate;

import java.io.File;
import java.io.IOException;

final class OfflineAssetVerifier {
    private OfflineAssetVerifier() {}

    static Result verify(File dataRoot, String relativePath, long expectedBytes) {
        if (relativePath == null || relativePath.isBlank()) {
            return new Result("", false, 0, false);
        }
        try {
            File root = dataRoot.getCanonicalFile();
            File asset = new File(root, relativePath).getCanonicalFile();
            if (!asset.getPath().startsWith(root.getPath() + File.separator)) {
                return new Result(relativePath, false, 0, false);
            }
            if (!asset.isFile()) {
                return new Result(relativePath, false, 0, false);
            }
            long size = Math.max(0, asset.length());
            boolean valid =
                expectedBytes <= 0 || size == 0 || size == expectedBytes;
            if (!valid) {
                asset.delete();
            }
            return new Result(relativePath, true, size, valid);
        } catch (IOException error) {
            return new Result(relativePath, false, 0, false);
        }
    }

    static final class Result {
        final String path;
        final boolean exists;
        final long size;
        final boolean valid;

        Result(String path, boolean exists, long size, boolean valid) {
            this.path = path;
            this.exists = exists;
            this.size = size;
            this.valid = valid;
        }
    }
}
