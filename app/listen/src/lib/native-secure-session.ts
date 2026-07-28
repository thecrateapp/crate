import { Capacitor, registerPlugin } from "@capacitor/core";

interface CrateSecureSessionPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  listKeys(options: { prefix: string }): Promise<{ keys: string[] }>;
  clearPrefix(options: { prefix: string }): Promise<{ removed: number }>;
}

const plugin = registerPlugin<CrateSecureSessionPlugin>("CrateSecureSession");
const KEY_PATTERN = /^crate\.(?:session|oauth)\.[A-Za-z0-9._~-]+$/;
const PREFIX_PATTERN = /^crate\.(?:session|oauth)\.$/;

export class NativeSecureSessionUnavailableError extends Error {
  constructor() {
    super("Native secure session storage is unavailable");
    this.name = "NativeSecureSessionUnavailableError";
  }
}

function validateKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error("Invalid secure session key");
  }
}

function validatePrefix(prefix: string): void {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error("Invalid secure session prefix");
  }
}

function ensureNative(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new NativeSecureSessionUnavailableError();
  }
}

function validateJson(value: string): void {
  if (!value || value.length > 64 * 1024) {
    throw new Error("Invalid secure session value");
  }
  try {
    JSON.parse(value);
  } catch {
    throw new Error("Invalid secure session value");
  }
}

function unavailable(): NativeSecureSessionUnavailableError {
  return new NativeSecureSessionUnavailableError();
}

export async function getSecureSessionValue(
  key: string,
): Promise<string | null> {
  validateKey(key);
  ensureNative();
  try {
    return (await plugin.get({ key })).value;
  } catch {
    throw unavailable();
  }
}

export async function setSecureSessionValue(
  key: string,
  value: string,
): Promise<void> {
  validateKey(key);
  validateJson(value);
  ensureNative();
  try {
    await plugin.set({ key, value });
  } catch {
    throw unavailable();
  }
}

export async function removeSecureSessionValue(key: string): Promise<void> {
  validateKey(key);
  ensureNative();
  try {
    await plugin.remove({ key });
  } catch {
    throw unavailable();
  }
}

export async function listSecureSessionKeys(prefix: string): Promise<string[]> {
  validatePrefix(prefix);
  ensureNative();
  try {
    const result = await plugin.listKeys({ prefix });
    return result.keys.filter((key) => KEY_PATTERN.test(key));
  } catch {
    throw unavailable();
  }
}

export async function clearSecureSessionPrefix(
  prefix: string,
): Promise<number> {
  validatePrefix(prefix);
  ensureNative();
  try {
    return (await plugin.clearPrefix({ prefix })).removed;
  } catch {
    throw unavailable();
  }
}
