import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

const STEPS = ["Account", "API Keys", "Library Scan", "Done"];

export function Setup() {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const [keys, setKeys] = useState({
    lastfm_apikey: "",
    ticketmaster_api_key: "",
    spotify_id: "",
    spotify_secret: "",
    fanart_api_key: "",
    setlistfm_api_key: "",
  });
  const [savingKeys, setSavingKeys] = useState(false);

  const [scanning, setScanning] = useState(false);

  async function createAdmin() {
    setCreating(true);
    try {
      await api("/api/setup/admin", "POST", { email, password, name });
      await api("/api/auth/login", "POST", { email, password });
      toast.success("Admin account created");
      setStep(1);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create admin");
    }
    setCreating(false);
  }

  async function saveKeys() {
    setSavingKeys(true);
    try {
      const res = await api<{ saved: number }>("/api/setup/keys", "POST", keys);
      toast.success(`Saved ${res.saved} API keys`);
      setStep(2);
    } catch {
      toast.error("Failed to save keys");
    }
    setSavingKeys(false);
  }

  async function startScan() {
    setScanning(true);
    try {
      await api("/api/setup/scan", "POST");
      toast.success("Library scan started");
      setStep(3);
    } catch {
      toast.error("Failed to start scan");
    }
    setScanning(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-lg py-8">
        <CrateLogo title="Crate" className="mx-auto mb-6 w-16" />

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/20 text-primary border border-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-8 h-px ${
                    i < step ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-md p-5 sm:p-8">
          {/* Step 0: Admin Account */}
          {step === 0 && (
            <div>
              <h1 className="mb-1 text-lg font-bold font-display">
                Create Admin Account
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                This will be your login to manage Crate.
              </p>
              <div className="space-y-3">
                <FormField label="Name (optional)">
                  <Input
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField label="Email">
                  <Input
                    name="email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </FormField>
                <FormField label="Password">
                  <Input
                    name="password"
                    autoComplete="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </FormField>
              </div>
              <Button
                className="w-full mt-6"
                onClick={createAdmin}
                disabled={creating || !email || !password}
                loading={creating}
              >
                Create Account
              </Button>
            </div>
          )}

          {/* Step 1: API Keys */}
          {step === 1 && (
            <div>
              <h1 className="mb-1 text-lg font-bold font-display">API Keys</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Optional — enable enrichment features. You can add these later
                in Settings.
              </p>
              <div className="space-y-3">
                {[
                  {
                    key: "lastfm_apikey",
                    label: "Last.fm API Key",
                    desc: "Artist bios, similar artists",
                    url: "https://www.last.fm/api/account/create",
                  },
                  {
                    key: "ticketmaster_api_key",
                    label: "Ticketmaster Key",
                    desc: "Upcoming shows",
                    url: "https://developer.ticketmaster.com/",
                  },
                  {
                    key: "spotify_id",
                    label: "Spotify Client ID",
                    desc: "Artist images",
                    url: "https://developer.spotify.com/dashboard",
                  },
                  {
                    key: "spotify_secret",
                    label: "Spotify Client Secret",
                    desc: "",
                    url: "",
                  },
                  {
                    key: "fanart_api_key",
                    label: "Fanart.tv Key",
                    desc: "Artist backgrounds",
                    url: "https://fanart.tv/get-an-api-key/",
                  },
                  {
                    key: "setlistfm_api_key",
                    label: "Setlist.fm Key",
                    desc: "Concert setlists",
                    url: "https://api.setlist.fm/docs/1.0/index.html",
                  },
                ].map(({ key, label, desc, url }) => (
                  <FormField
                    key={key}
                    id={`setup-${key}`}
                    label={label}
                    hint={
                      <>
                        {desc}
                        {url ? (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-action-hi hover:underline"
                            >
                              Get key
                            </a>
                          </>
                        ) : null}
                      </>
                    }
                  >
                    <Input
                      value={keys[key as keyof typeof keys]}
                      onChange={(e) =>
                        setKeys((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    />
                  </FormField>
                ))}
              </div>
              <div className="flex gap-2 mt-6">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Skip for now
                </Button>
                <Button
                  className="flex-1"
                  onClick={saveKeys}
                  disabled={savingKeys}
                  loading={savingKeys}
                >
                  Save Keys
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Library Scan */}
          {step === 2 && (
            <div className="text-center">
              <h1 className="text-lg font-bold mb-2 font-display">
                Scan Your Library
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                Crate will scan your music collection, read tags, and build your
                library database. This runs in the background — you can start
                using Crate while it works.
              </p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  Skip — I'll scan later
                </Button>
                <Button
                  onClick={startScan}
                  disabled={scanning}
                  loading={scanning}
                >
                  Start Scan
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center">
              <h1 className="text-lg font-bold mb-2 font-display">
                You're all set!
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                Crate is scanning your library in the background. This may take
                a while depending on your collection size.
              </p>
              <Button
                onClick={() => {
                  window.location.href = "/";
                }}
                className="w-full"
              >
                Go to Dashboard
              </Button>
            </div>
          )}
        </div>

        <MonoLabel as="p" className="mt-4 text-center" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </MonoLabel>
      </div>
    </div>
  );
}
