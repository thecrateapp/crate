type Clipboard = Pick<globalThis.Clipboard, "writeText">;

export async function copyText(
  text: string,
  clipboard: Clipboard | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
