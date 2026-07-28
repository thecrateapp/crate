import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const isReleaseBuild = process.env.CRATE_MOBILE_RELEASE === "true";
const allowMixedContent =
  !isReleaseBuild && process.env.CRATE_ALLOW_MIXED_CONTENT === "true";

if (isReleaseBuild && process.env.CRATE_ALLOW_MIXED_CONTENT === "true") {
  throw new Error("Release mobile builds cannot enable mixed content");
}

const config: CapacitorConfig = {
  // Reverse-DNS of the project domain (cratemusic.app). Native apps are
  // branded as "Crate", so the id drops the old ".listen" segment that dated
  // from a time when admin + listen were sibling apps.
  appId: "app.cratemusic.crate",
  appName: "Crate",
  webDir: "dist",

  server: {
    // App loads from the local bundle. API calls use bearer headers and
    // browser media surfaces use short-lived scoped tickets.
    androidScheme: "https",
    iosScheme: "https",
    allowMixedContent,
  },

  ios: {
    contentInset: "never",
    backgroundColor: "#0a0a0f",
    preferredContentMode: "mobile",
  },

  android: {
    backgroundColor: "#0a0a0f",
    allowMixedContent,
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 350,
      backgroundColor: "#0a0a0f",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      overlaysWebView: true,
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
