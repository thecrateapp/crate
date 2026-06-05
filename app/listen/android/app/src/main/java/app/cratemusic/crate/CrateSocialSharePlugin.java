package app.cratemusic.crate;

import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "CrateSocialShare")
public class CrateSocialSharePlugin extends Plugin {
    private static final String INSTAGRAM_PACKAGE = "com.instagram.android";
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void canShareInstagramStory(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("available", isInstagramAvailable());
        call.resolve(payload);
    }

    @PluginMethod
    public void shareInstagramStory(PluginCall call) {
        String imageDataUrl = call.getString("imageDataUrl", "");
        String contentUrl = call.getString("contentUrl", "");
        if (!isInstagramAvailable()) {
            call.reject("Instagram is not installed");
            return;
        }
        if (imageDataUrl.isEmpty()) {
            call.reject("Missing story image");
            return;
        }

        try {
            StoryImage storyImage = writeStoryImage(imageDataUrl);
            getActivity().runOnUiThread(() -> {
                try {
                    shareStoryImage(storyImage, contentUrl);
                    JSObject payload = new JSObject();
                    payload.put("shared", true);
                    call.resolve(payload);
                } catch (ActivityNotFoundException error) {
                    call.reject("Instagram Stories is not available", error);
                } catch (Exception error) {
                    call.reject("Failed to open Instagram Stories", error);
                }
            });
        } catch (Exception error) {
            call.reject("Failed to prepare Instagram story", error);
        }
    }

    @PluginMethod
    public void loadImageDataUrl(PluginCall call) {
        String imageUrl = call.getString("url", "");
        if (imageUrl.isEmpty()) {
            call.reject("Missing image URL");
            return;
        }

        imageExecutor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(imageUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(5_000);
                connection.setReadTimeout(10_000);
                connection.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
                connection.setRequestProperty("User-Agent", "Crate Android");

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("Failed to load share artwork: HTTP " + status);
                    return;
                }

                byte[] bytes;
                try (InputStream input = connection.getInputStream()) {
                    bytes = readBytes(input);
                }
                if (bytes.length == 0) {
                    call.reject("Failed to load share artwork: empty response");
                    return;
                }

                String mimeType = normalizeImageMime(connection.getContentType(), imageUrl);
                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                JSObject payload = new JSObject();
                payload.put("dataUrl", "data:" + mimeType + ";base64," + base64);
                call.resolve(payload);
            } catch (Exception error) {
                call.reject("Failed to load share artwork", error);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    private void shareStoryImage(StoryImage storyImage, String contentUrl) {
        getContext().grantUriPermission(
            INSTAGRAM_PACKAGE,
            storyImage.uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION
        );

        Intent addToStoryIntent = new Intent("com.instagram.share.ADD_TO_STORY");
        addToStoryIntent.setPackage(INSTAGRAM_PACKAGE);
        addToStoryIntent.setDataAndType(storyImage.uri, storyImage.mimeType);
        addToStoryIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        addToStoryIntent.putExtra("source_application", getContext().getPackageName());
        if (contentUrl != null && !contentUrl.isEmpty()) {
            addToStoryIntent.putExtra("content_url", contentUrl);
        }
        getActivity().startActivity(addToStoryIntent);
    }

    private static class StoryImage {
        final Uri uri;
        final String mimeType;

        StoryImage(Uri uri, String mimeType) {
            this.uri = uri;
            this.mimeType = mimeType;
        }
    }

    private boolean isInstagramAvailable() {
        try {
            getContext().getPackageManager().getPackageInfo(INSTAGRAM_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    private StoryImage writeStoryImage(String imageDataUrl) throws IOException {
        String base64Payload = imageDataUrl;
        String mimeType = "image/jpeg";
        int commaIndex = imageDataUrl.indexOf(',');
        if (commaIndex >= 0) {
            mimeType = parseMimeType(imageDataUrl.substring(0, commaIndex));
            base64Payload = imageDataUrl.substring(commaIndex + 1);
        }
        byte[] bytes = Base64.decode(base64Payload, Base64.DEFAULT);
        File dir = new File(getContext().getCacheDir(), "social-share");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Could not create share cache");
        }
        File image = new File(dir, "crate-instagram-story" + extensionForMime(mimeType));
        try (FileOutputStream output = new FileOutputStream(image, false)) {
            output.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            image
        );
        return new StoryImage(uri, mimeType);
    }

    private String parseMimeType(String dataUrlHeader) {
        if (dataUrlHeader.startsWith("data:")) {
            int semicolonIndex = dataUrlHeader.indexOf(';');
            if (semicolonIndex > 5) {
                return dataUrlHeader.substring(5, semicolonIndex);
            }
        }
        return "image/jpeg";
    }

    private String extensionForMime(String mimeType) {
        if ("image/png".equalsIgnoreCase(mimeType)) return ".png";
        if ("image/webp".equalsIgnoreCase(mimeType)) return ".webp";
        return ".jpg";
    }

    private byte[] readBytes(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16_384];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private String normalizeImageMime(String contentType, String imageUrl) {
        if (contentType != null && !contentType.isEmpty()) {
            String mime = contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
            if (mime.startsWith("image/")) {
                if ("image/jpg".equals(mime)) return "image/jpeg";
                return mime;
            }
        }
        return inferImageMimeFromUrl(imageUrl);
    }

    private String inferImageMimeFromUrl(String imageUrl) {
        String lower = imageUrl.toLowerCase(Locale.ROOT).split("\\?")[0];
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "image/png";
    }

    @Override
    protected void handleOnDestroy() {
        imageExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
