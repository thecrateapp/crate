import { GithubIcon } from "./GithubIcon";

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#050507]/92 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-4 px-4 sm:gap-6 sm:px-8">
        <a href="/" className="flex min-w-0 items-center gap-2">
          <img src="/icons/logo.svg" alt="" className="h-7 w-7" />
          <span className="hidden font-mono text-[12px] uppercase text-white/76 min-[380px]:inline">
            Crate
          </span>
        </a>

        <nav className="ml-auto flex min-w-0 items-center gap-4 sm:gap-5">
          <a
            href="https://docs.cratemusic.app/technical/quickstart"
            target="_blank"
            rel="noreferrer"
            className="hidden font-mono text-[12px] uppercase text-white/50 underline decoration-white/16 underline-offset-4 transition hover:text-white sm:inline"
          >
            Quickstart
          </a>
          <a
            href="/why"
            className="font-mono text-[12px] uppercase text-white/50 underline decoration-white/16 underline-offset-4 transition hover:text-white"
          >
            Manifesto
          </a>
          <a
            href="https://docs.cratemusic.app"
            target="_blank"
            rel="noreferrer"
            className="hidden font-mono text-[12px] uppercase text-white/50 underline decoration-white/16 underline-offset-4 transition hover:text-white sm:inline"
          >
            Docs
          </a>
          <a
            href="https://github.com/thecrateapp/crate"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-mono text-[12px] uppercase text-white/60 transition hover:text-white"
          >
            <GithubIcon size={14} />
            Source
          </a>
        </nav>
      </div>
    </header>
  );
}
