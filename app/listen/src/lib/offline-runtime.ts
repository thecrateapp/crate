import { isNative } from "@/lib/capacitor-runtime";
import { isTauriRuntime } from "@/lib/platform";

/** Offline storage is native when the shell owns a persistent app directory. */
export const isOfflineNativeRuntime = isNative || isTauriRuntime;
