package app.cratemusic.crate;

import android.content.Intent;
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

@CapacitorPlugin(name = "CrateSocialShare")
public class CrateSocialSharePlugin extends Plugin {
    private static final String INSTAGRAM_PACKAGE = "com.instagram.android";

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
            shareStoryImage(storyImage);
            JSObject payload = new JSObject();
            payload.put("shared", true);
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("Failed to share to Instagram Stories", error);
        }
    }

    private void shareStoryImage(StoryImage storyImage) {
        getContext().grantUriPermission(
            INSTAGRAM_PACKAGE,
            storyImage.uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION
        );

        Intent addToStoryIntent = new Intent("com.instagram.share.ADD_TO_STORY");
        addToStoryIntent.setPackage(INSTAGRAM_PACKAGE);
        addToStoryIntent.setDataAndType(storyImage.uri, "image/*");
        addToStoryIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
}
