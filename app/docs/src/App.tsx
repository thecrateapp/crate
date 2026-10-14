import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";

import { MarkdownArticle } from "@/components/MarkdownArticle";
import {
  docsBySection,
  filterDocs,
  getAdjacentDocs,
  getDoc,
  loadDoc,
  sectionMeta,
  sourceUrl,
  type DocEntry,
  type DocHeading,
  type DocSection,
  type LoadedDoc,
} from "@/content";

const SITE = "https://cratemusic.app";
const GITHUB = "https://github.com/thecrateapp/crate";

const siteLinks = [
  { href: `${SITE}/listen`, label: "Listen" },
  { href: `${SITE}/admin`, label: "Admin" },
  { href: `${SITE}/architecture`, label: "Architecture" },
  { href: `${SITE}/developers`, label: "Developers" },
  { href: "/", label: "Docs", docs: true },
  { href: GITHUB, label: "GitHub" },
];

const sections = Object.keys(sectionMeta) as DocSection[];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function SiteLinks({ onNavigate }: { onNavigate?: () => void }) {
  return siteLinks.map((link, index) =>
    link.docs ? (
      <Link
        key={link.label}
        to={link.href}
        className="is-current"
        aria-current="true"
        onClick={onNavigate}
        style={{ "--i": index } as CSSProperties}
      >
        {link.label}
      </Link>
    ) : (
      <a
        key={link.label}
        href={link.href}
        style={{ "--i": index } as CSSProperties}
      >
        {link.label}
      </a>
    ),
  );
}

function Brand() {
  return (
    <div className="brand-group">
      <a className="brand" href={SITE}>
        <img src="/icons/logo.svg" alt="" width={24} height={24} />
        Crate
      </a>
      <Link to="/" className="brand-chip">
        Docs
      </Link>
    </div>
  );
}

function SiteHeader({
  menuOpen,
  onMenu,
  toggleRef,
}: {
  menuOpen: boolean;
  onMenu: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="nav">
      <Brand />
      <nav className="nav-links" aria-label="Primary">
        <SiteLinks />
      </nav>
      <button
        ref={toggleRef}
        type="button"
        className="menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="docs-menu"
        onClick={onMenu}
      >
        Menu
      </button>
    </header>
  );
}

function DocsIndex({
  query,
  onQueryChange,
  searchRef,
  inputId,
  onNavigate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  inputId: string;
  onNavigate?: () => void;
}) {
  const filtered = filterDocs(query);
  const empty = sections.every((section) => !filtered[section].length);

  return (
    <div className="docs-index">
      <div className="search">
        <label htmlFor={inputId} className="sr-only">
          Search documentation
        </label>
        <input
          ref={searchRef}
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search docs"
          autoComplete="off"
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      <nav aria-label="Documentation">
        {empty ? (
          <p className="index-empty">No documents match “{query.trim()}”</p>
        ) : null}
        {sections.map((section, index) => {
          const items = filtered[section];
          if (!items.length) return null;
          return (
            <div key={section} className="index-section">
              <p className="index-label">
                <b>{pad(index + 1)}</b>
                {sectionMeta[section].label}
              </p>
              <ul>
                {items.map((doc) => (
                  <li key={doc.id}>
                    <NavLink to={doc.route} onClick={onNavigate}>
                      {doc.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function Sidebar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const sidebar = ref.current;
    const active = sidebar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!sidebar || !active) return;
    const top = active.offsetTop;
    const visible =
      top >= sidebar.scrollTop &&
      top + active.offsetHeight <= sidebar.scrollTop + sidebar.clientHeight;
    if (!visible) sidebar.scrollTop = top - sidebar.clientHeight / 3;
  }, [pathname]);

  return (
    <aside ref={ref} className="sidebar">
      {children}
    </aside>
  );
}

function MobileMenu({
  onClose,
  query,
  onQueryChange,
}: {
  onClose: (restoreFocus?: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    document.documentElement.classList.add("menu-open");
    const wide = window.matchMedia?.("(min-width: 1024px)");
    const onWide = (event: MediaQueryListEvent) => {
      if (event.matches) onClose(false);
    };
    wide?.addEventListener("change", onWide);
    return () => {
      document.documentElement.classList.remove("menu-open");
      wide?.removeEventListener("change", onWide);
    };
  }, [onClose]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [
      ...panelRef.current.querySelectorAll<HTMLElement>("a, button, input"),
    ];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      ref={panelRef}
      className="menu"
      id="docs-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      onKeyDown={onKeyDown}
    >
      <div className="menu-bar">
        <Brand />
        <button
          ref={closeRef}
          type="button"
          className="menu-close"
          onClick={() => onClose()}
        >
          Close
        </button>
      </div>
      <nav className="menu-site" aria-label="Primary">
        <SiteLinks onNavigate={() => onClose(false)} />
      </nav>
      <DocsIndex
        query={query}
        onQueryChange={onQueryChange}
        inputId="docs-search-menu"
        onNavigate={() => onClose(false)}
      />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="footer">
      <a className="u-link" href={`${SITE}/why`}>
        Read the manifesto
      </a>
      <nav className="footer-links" aria-label="Footer">
        <a className="u-link" href={GITHUB}>
          GitHub
        </a>
        <a className="u-link" href={SITE}>
          cratemusic.app
        </a>
        <a className="u-link" href={`${GITHUB}/blob/main/LICENSE`}>
          AGPL-3.0
        </a>
      </nav>
    </footer>
  );
}

function DocList({
  docs,
  showSection,
}: {
  docs: DocEntry[];
  showSection?: boolean;
}) {
  return (
    <ol className="doc-list">
      {docs.map((doc, index) => (
        <li key={doc.id}>
          <Link to={doc.route}>
            <span className="n">{pad(index + 1)}</span>
            <span className="t">
              <span className="title">{doc.title}</span>
              <span className="summary">{doc.summary}</span>
            </span>
            <span className="s">
              {showSection ? sectionMeta[doc.section].label : "Read"}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function HomePage() {
  const systemOverview = getDoc("architecture", "system-overview");
  const readingPath = [
    docsBySection.start[0],
    systemOverview,
    docsBySection.developer[0],
    docsBySection.operations[0],
    docsBySection.federation[0],
  ].filter((doc): doc is DocEntry => Boolean(doc));

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">
          <b>Crate Documentation</b>Developer · Operations · Federation
        </p>
        <h1 className="display">
          The technical field guide for a self-hosted music platform.
        </h1>
        <p className="lede">
          Use the right path for local development, a single home instance or
          project-hosted image-first deployment. Federation is documented as a
          controlled node-to-node capability, not anonymous public peering.
        </p>
        <div className="actions">
          {systemOverview ? (
            <Link to={systemOverview.route} className="button">
              Start with the system overview
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
          <a href={GITHUB} target="_blank" rel="noreferrer" className="u-link">
            Source on GitHub
          </a>
        </div>
      </header>

      <section className="band" aria-labelledby="reading-path">
        <p className="eyebrow" id="reading-path">
          <b>Reading path</b>
          {readingPath.length} documents · in order
        </p>
        <DocList docs={readingPath} showSection />
      </section>

      <section className="band" aria-labelledby="sections">
        <p className="eyebrow" id="sections">
          <b>Sections</b>
          {sections.length} areas ·{" "}
          {sections.reduce(
            (total, section) => total + docsBySection[section].length,
            0,
          )}{" "}
          documents
        </p>
        <div className="explore">
          {sections.map((section, index) => (
            <Link key={section} to={`/${section}`}>
              <span className="label">
                <b>{pad(index + 1)}</b>
                {sectionMeta[section].label}
              </span>
              <span className="meta">
                <span className="desc">{sectionMeta[section].description}</span>
                <span>{docsBySection[section].length} docs</span>
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionPage() {
  const { section } = useParams();
  if (!section || !(section in docsBySection))
    return <Navigate to="/" replace />;

  const typedSection = section as DocSection;
  const entries = docsBySection[typedSection];
  const meta = sectionMeta[typedSection];

  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">
          <b>{meta.label}</b>
          {entries.length} documents in this section
        </p>
        <h1 className="display">{meta.label} documentation</h1>
        <p className="lede">{meta.description}</p>
      </header>
      <DocList docs={entries} />
    </div>
  );
}

function TableOfContents({ headings }: { headings: DocHeading[] }) {
  if (!headings.length) return null;
  return (
    <aside className="toc" aria-labelledby="toc-label">
      <p className="index-label" id="toc-label">
        On this page
      </p>
      <ul>
        {headings.map((heading) => (
          <li key={`${heading.level}-${heading.id}`} data-level={heading.level}>
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function DocMetaLine({ doc, loaded }: { doc: DocEntry; loaded?: LoadedDoc }) {
  const details = [
    loaded?.meta.verified ? `Verified ${loaded.meta.verified}` : null,
    ...(loaded?.meta.audience ?? []),
  ].filter(Boolean);

  return (
    <div className="doc-meta">
      <p className="eyebrow">
        <Link to={`/${doc.section}`}>
          <b>{sectionMeta[doc.section].label}</b>
        </Link>
        {details.join(" · ")}
      </p>
      <a
        className="u-link mono-link"
        href={sourceUrl(doc.sourcePath)}
        target="_blank"
        rel="noreferrer"
      >
        View source
      </a>
    </div>
  );
}

function LoadedDocument({ doc }: { doc: DocEntry }) {
  const [loaded, setLoaded] = useState<LoadedDoc>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let active = true;
    setLoaded(undefined);
    setError(undefined);

    void loadDoc(doc).then(
      (value) => {
        if (active) setLoaded(value);
      },
      (reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason
              : new Error("Unable to load document."),
          );
        }
      },
    );

    return () => {
      active = false;
    };
  }, [doc]);

  const adjacent = getAdjacentDocs(doc);

  return (
    <div className="doc-layout">
      <article className="doc">
        <DocMetaLine doc={doc} loaded={loaded} />
        {error ? (
          <aside className="callout" data-kind="warning" role="alert">
            <p className="callout-label">Error</p>
            <p>{error.message}</p>
          </aside>
        ) : loaded ? (
          <MarkdownArticle
            markdown={loaded.markdown}
            sourcePath={doc.sourcePath}
          />
        ) : (
          <p className="eyebrow loading">Loading document…</p>
        )}

        <nav className="pager" aria-label="Previous and next">
          {adjacent.previous ? (
            <Link to={adjacent.previous.route} className="prev">
              <span className="eyebrow">← Previous</span>
              <span className="title">{adjacent.previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {adjacent.next ? (
            <Link to={adjacent.next.route} className="next">
              <span className="eyebrow">Next →</span>
              <span className="title">{adjacent.next.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>

      <TableOfContents headings={loaded?.headings ?? []} />
    </div>
  );
}

function DocPage() {
  const params = useParams();
  const doc = getDoc(params.section, params.slug);
  if (!doc) return <Navigate to="/" replace />;

  return <LoadedDocument key={doc.id} doc={doc} />;
}

function NotFoundPage() {
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">
          <b>404</b>Not found
        </p>
        <h1 className="display">This documentation page does not exist.</h1>
        <div className="actions">
          <Link to="/" className="button">
            Back to docs home
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useRef((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }).current;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable)
        return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="docs-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <SiteHeader
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen(true)}
        toggleRef={toggleRef}
      />
      {menuOpen ? (
        <MobileMenu
          onClose={closeMenu}
          query={query}
          onQueryChange={setQuery}
        />
      ) : null}
      <div className="shell">
        <Sidebar>
          <DocsIndex
            query={query}
            onQueryChange={setQuery}
            searchRef={searchRef}
            inputId="docs-search"
          />
        </Sidebar>
        <main id="content" className="main">
          <div key={location.pathname} className="page-enter">
            <Routes>
              <Route index element={<HomePage />} />
              <Route path=":section" element={<SectionPage />} />
              <Route path=":section/:slug" element={<DocPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
