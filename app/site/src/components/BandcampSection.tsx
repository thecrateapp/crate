export function BandcampSection() {
  return (
    <section id="bandcamp" className="relative py-24 sm:py-32">
      {/* Subtle cyan radial glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(6,182,212,0.04),transparent_70%)]" />

      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="mb-4 text-center">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Direct Support
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.1]">
            Bandcamp is the bridge.
          </h2>
          <p className="mx-auto mt-3 max-w-[640px] text-base leading-7 text-white/55 sm:text-lg sm:leading-8">
            Connect your Bandcamp account, and Crate links every artist and
            album to their Bandcamp page. Supporting an artist is one click.
            Owning what you bought is automatic.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-3">
          <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-7">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <h3 className="mb-2 text-[15px] font-semibold text-white/90">
              Import your collection
            </h3>
            <p className="text-[14px] leading-relaxed text-white/50">
              Connect your Bandcamp account and Crate pulls in your purchases,
              wishlist, and followed artists. Every album you bought is
              available to import into your library.
            </p>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-7">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <h3 className="mb-2 text-[15px] font-semibold text-white/90">
              Support in one click
            </h3>
            <p className="text-[14px] leading-relaxed text-white/50">
              Every artist and album page in Crate shows a Bandcamp link when
              one exists. Listening to a record you love? Click through and buy
              it. The money goes to the artist, not a platform.
            </p>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-7">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3 className="mb-2 text-[15px] font-semibold text-white/90">
              Your contribution is tracked
            </h3>
            <p className="text-[14px] leading-relaxed text-white/50">
              Every album you import from Bandcamp is recorded as your
              contribution. If you ever leave, you can export or withdraw what
              you brought. The library is shared, but your support is yours.
            </p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <a
            href="https://docs.cratemusic.app/bandcamp/overview"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08]"
          >
            Learn how Bandcamp integration works
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
