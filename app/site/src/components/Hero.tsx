import { useState } from "react";

const INSTALL_COMMAND = "curl -fsSL https://cratemusic.app/install.sh | bash";
const HELP_URL =
  "https://github.com/thecrateapp/crate/issues/new?title=Help%20installing%20Crate";

function InstallerBlock() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      } else {
        const input = document.createElement("textarea");
        input.value = INSTALL_COMMAND;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-6 max-w-3xl overflow-hidden">
      <div className="mt-2 flex flex-col items-start gap-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
        <code className="w-full min-w-0 overflow-x-auto whitespace-nowrap rounded-sm border border-cyan-200/12 bg-black/20 px-3 py-2 font-mono text-[12px] leading-6 text-cyan-100 sm:flex-1 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-[15px] sm:leading-7">
          <span className="select-none text-cyan-200/45" aria-hidden="true">
            $
          </span>{" "}
          {INSTALL_COMMAND}
        </code>
        <div className="flex shrink-0 gap-x-5">
          <button
            type="button"
            onClick={copyInstallCommand}
            className="font-mono text-[12px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
            aria-label="Copy installer command"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
          >
            Help
          </a>
        </div>
      </div>
      <p className="mt-1 font-mono text-[11px] uppercase text-white/28">
        Installs Crate server on Linux (x86_64).{" "}
        <a
          href="https://github.com/thecrateapp/crate"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-white/12 underline-offset-4 transition hover:text-white/38"
        >
          Read the source
        </a>{" "}
        first if you prefer.
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative border-b border-white/10 px-4 py-10 sm:px-8 sm:py-14">
      <div className="hud-frame mx-auto flex max-w-[1500px] px-0 py-2 lg:min-h-[calc(100svh-7rem)] lg:items-start lg:pt-8">
        <div className="relative isolate w-full max-w-[1120px]">
          <img
            src="/icons/logo.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -left-28 top-2 z-0 h-[360px] w-[338px] max-w-none opacity-[0.045] mix-blend-screen sm:-left-44 sm:top-0 sm:h-[540px] sm:w-[507px] lg:-left-56 lg:top-2 lg:h-[680px] lg:w-[638px] [filter:drop-shadow(0_0_50px_rgba(103,232,249,0.2))]"
          />

          <div className="relative z-10">
            <p className="mb-5 font-mono text-[12px] uppercase text-cyan-200">
              FREE MUSIC PLATFORM / OPEN SOURCE / SELF HOSTED
            </p>
            <h1 className="max-w-full text-[clamp(42px,13.5vw,58px)] font-extrabold uppercase leading-[0.88] text-white [text-shadow:0_0_34px_rgba(103,232,249,0.12)] sm:max-w-[12ch] sm:text-[92px] sm:leading-[0.86] lg:text-[82px] xl:text-[90px] 2xl:text-[108px]">
              Crate is not a streaming service.
            </h1>

            <p className="mt-5 text-[clamp(23px,7vw,28px)] font-extrabold uppercase leading-none tracking-normal text-cyan-200 [text-shadow:0_0_24px_rgba(103,232,249,0.22)] sm:text-[42px] lg:text-[48px]">
              Is a tool for revolution
            </p>

            <p className="mt-6 max-w-3xl text-[18px] leading-8 text-white/68 sm:text-[21px] sm:leading-9">
              Crate is free, open-source software for taking music back from
              streaming platforms and returning it to the people who give it
              meaning: fans and artists. No subscriptions. No algorithms.
            </p>

            <p className="mt-6 max-w-3xl text-[18px] leading-8 text-white/68 sm:text-[21px] sm:leading-9">
              Install it in your server. Bring your files. Tell your friends.
              Start a community and break with the system.
            </p>
            <p className="mt-6 max-w-3xl text-[18px] leading-8 text-white/68 sm:text-[21px] sm:leading-9">
              Own your music. Support your artists. Refuse the middleman.
            </p>
            <InstallerBlock />
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 py-4">
              <a
                href="/why"
                className="font-mono text-[14px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
              >
                the manifesto
              </a>
              <a
                href="https://github.com/thecrateapp/crate"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[14px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
              >
                the source
              </a>
              <a
                href="https://docs.cratemusic.app/"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[14px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
              >
                the docs
              </a>
            </div>
          </div>
          <a
            href="/why"
            className="mt-12 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase text-white/22 transition hover:text-white/40"
          >
            Read the manifesto
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
              className="mt-px"
            >
              <path
                d="M5 1v7M2 5l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
