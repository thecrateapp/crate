/** Decode bounded local artwork before publishing it. Never treats an HTTP success as an image. */
export function validateOfflineArtworkImage(
  src: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("Offline artwork cancelled", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else resolve();
    };
    const abort = () =>
      finish(new DOMException("Offline artwork cancelled", "AbortError"));
    const timeout = setTimeout(
      () => finish(new Error("Offline artwork could not be decoded")),
      10_000,
    );
    image.onload = () =>
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? undefined
          : new Error("Invalid offline artwork"),
      );
    image.onerror = () => finish(new Error("Invalid offline artwork"));
    signal?.addEventListener("abort", abort, { once: true });
    image.src = src;
    if (signal?.aborted) abort();
  });
}
