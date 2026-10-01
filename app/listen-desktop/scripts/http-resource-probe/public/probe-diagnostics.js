(() => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const record = (message) => {
    if (typeof invoke !== "function") return;
    void invoke("record_probe_diagnostic", { message }).catch(() => undefined);
  };

  record("frontend-bootstrap-loaded");

  window.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLScriptElement) {
        record(`script-error:${event.target.src}`);
      } else {
        record(`window-error:${event.message}`);
      }
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    record(`unhandled-rejection:${String(event.reason)}`);
  });

  const moduleScript = document.querySelector('script[type="module"]');
  if (moduleScript) {
    moduleScript.addEventListener("load", () => {
      record(`module-script-loaded:${moduleScript.src}`);
    });
    moduleScript.addEventListener("error", () => {
      record(`module-script-error:${moduleScript.src}`);
    });
  }
})();
