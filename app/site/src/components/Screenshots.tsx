type Screenshot = {
  title: string;
  surface: "Listen" | "Admin";
  src: string;
};

const SCREENSHOTS: Screenshot[] = [
  {
    title: "Personal home",
    surface: "Listen",
    src: "/showcase/listen/home.webp",
  },
  {
    title: "Fullscreen player",
    surface: "Listen",
    src: "/showcase/listen/player.webp",
  },
  {
    title: "Album view",
    surface: "Listen",
    src: "/showcase/listen/album.webp",
  },
  {
    title: "Artist profile",
    surface: "Listen",
    src: "/showcase/listen/artist.webp",
  },
  { title: "Explore", surface: "Listen", src: "/showcase/listen/explore.webp" },
  {
    title: "Search overlay",
    surface: "Listen",
    src: "/showcase/listen/home-search.webp",
  },
  {
    title: "Listening stats",
    surface: "Listen",
    src: "/showcase/listen/stats.webp",
  },
  {
    title: "Upcoming releases",
    surface: "Listen",
    src: "/showcase/listen/upcoming.webp",
  },
  {
    title: "Album collection",
    surface: "Listen",
    src: "/showcase/listen/collection-albums.webp",
  },
  {
    title: "Artist collection",
    surface: "Listen",
    src: "/showcase/listen/collection-artists.webp",
  },
  {
    title: "Operations dashboard",
    surface: "Admin",
    src: "/showcase/admin/dashboard.webp",
  },
  {
    title: "Album intelligence",
    surface: "Admin",
    src: "/showcase/admin/album-view.webp",
  },
  {
    title: "Artist overview",
    surface: "Admin",
    src: "/showcase/admin/artist-view.webp",
  },
  {
    title: "Artist discography",
    surface: "Admin",
    src: "/showcase/admin/artist-discography.webp",
  },
  {
    title: "Artist network",
    surface: "Admin",
    src: "/showcase/admin/artist-network.webp",
  },
  {
    title: "Artist stats",
    surface: "Admin",
    src: "/showcase/admin/artist-stats.webp",
  },
  {
    title: "Library browse",
    surface: "Admin",
    src: "/showcase/admin/browse.webp",
  },
  {
    title: "Discovery console",
    surface: "Admin",
    src: "/showcase/admin/discovery.webp",
  },
  {
    title: "Tidal acquisition",
    surface: "Admin",
    src: "/showcase/admin/acquistion-tidal.webp",
  },
  {
    title: "Library health",
    surface: "Admin",
    src: "/showcase/admin/library-health.webp",
  },
  {
    title: "Analysis pipeline",
    surface: "Admin",
    src: "/showcase/admin/analysis.webp",
  },
  {
    title: "System health",
    surface: "Admin",
    src: "/showcase/admin/system-health.webp",
  },
  {
    title: "System metrics",
    surface: "Admin",
    src: "/showcase/admin/system-metrics.webp",
  },
  { title: "Task queue", surface: "Admin", src: "/showcase/admin/tasks.webp" },
  {
    title: "Stack services",
    surface: "Admin",
    src: "/showcase/admin/stack.webp",
  },
  {
    title: "Collection insights",
    surface: "Admin",
    src: "/showcase/admin/collection-insigths.webp",
  },
  {
    title: "Genre workspace",
    surface: "Admin",
    src: "/showcase/admin/genres.webp",
  },
  {
    title: "Genre detail",
    surface: "Admin",
    src: "/showcase/admin/genre.webp",
  },
  {
    title: "Genre tree",
    surface: "Admin",
    src: "/showcase/admin/genre-tree.webp",
  },
  {
    title: "Genre EQ preset",
    surface: "Admin",
    src: "/showcase/admin/genre-eq-preset.webp",
  },
  {
    title: "New releases",
    surface: "Admin",
    src: "/showcase/admin/new-releases.webp",
  },
  { title: "Users", surface: "Admin", src: "/showcase/admin/users.webp" },
  { title: "Settings", surface: "Admin", src: "/showcase/admin/settings.webp" },
];

export function Screenshots() {
  return (
    <section className="relative px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-[1500px]">
        <a
          href="/"
          className="font-mono text-[12px] uppercase text-white/42 underline decoration-white/20 underline-offset-4 transition hover:text-white"
        >
          Back to home
        </a>

        <div className="mt-12 grid gap-10 border-b border-white/12 pb-12 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <p className="mb-5 font-mono text-[12px] uppercase text-cyan-200">
              screenshots
            </p>
            <h1 className="max-w-2xl text-[44px] font-extrabold uppercase leading-[0.98] text-white sm:text-[72px]">
              Current captures.
            </h1>
          </div>
          <p className="max-w-3xl self-end text-[18px] leading-8 text-white/62 sm:text-[21px] sm:leading-9">
            These are here so you can see the software before running it. They
            are not the argument for Crate, and they will change.
          </p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {SCREENSHOTS.map((shot, index) => (
            <figure
              key={shot.src}
              className="[content-visibility:auto] [contain-intrinsic-size:720px]"
            >
              <div className="aspect-[16/10] border border-white/12 bg-black">
                <img
                  src={shot.src}
                  alt={`${shot.title} screenshot`}
                  loading={index < 2 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                  className="h-full w-full object-contain"
                />
              </div>
              <figcaption className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3 font-mono text-[12px] uppercase">
                <span className="text-white/68">{shot.title}</span>
                <span className="text-cyan-200/72">{shot.surface}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
