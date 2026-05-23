import { GithubIcon } from "./GithubIcon";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/10 px-5 py-10 sm:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="flex items-center gap-3">
            <img src="/icons/logo.svg" alt="" className="h-7 w-7" />
            <span className="font-mono text-[12px] uppercase text-white/72">
              Crate
            </span>
          </div>
          <p className="mt-4 max-w-xl text-[13px] leading-6 text-white/42">
            Own your music. Support your artists. Refuse the middleman.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3 font-mono text-[12px] uppercase text-white/48">
          <a href="/why" className="transition hover:text-white">
            Manifesto
          </a>
          <a
            href="https://docs.cratemusic.app"
            className="transition hover:text-white"
          >
            Docs
          </a>
          <a
            href="https://github.com/thecrateapp/crate"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-white"
          >
            <GithubIcon size={13} />
            Source
          </a>
          <span className="text-white/28">{year}</span>
        </div>
      </div>
    </footer>
  );
}
