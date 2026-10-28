import "../../../app/listen/src/index.css";
import { useRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { TopBarSearchInput } from "../../../app/listen/src/components/layout/topbar/TopBarSearchView";

type SearchProps = ComponentProps<typeof TopBarSearchInput>;
const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);
const noop = () => {};
// Fix the view state so both clipping geometries are independent of controller timers.
const searchOpen = new URLSearchParams(location.search).get("open") === "true";
const messages: Record<string, string> = {
  "search.label": "Search",
  "search.placeholder": "Search artists, albums, tracks...",
};

function TopBarSearchFixture() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-6 p-8">
      <button type="button" data-testid="before-search">
        Before search
      </button>
      <header className="flex items-center justify-end">
        <TopBarSearchInput
          state={{
            query: "",
            results: [],
            loading: false,
            completedQuery: null,
            searchError: null,
            showDropdown: false,
            activeIdx: -1,
            recents: [],
            searchOpen,
          }}
          environment={{
            canHover: false,
            isDesktop: matchMedia("(min-width: 768px)").matches,
          }}
          refs={{ containerRef, dropdownRef, inputRef, triggerRef, dropdownStyle: null }}
          actions={{
            openSearch: noop,
            focusInputSoon: noop,
            scheduleCollapseIfIdle: noop,
            collapseOnFocusExit: noop,
            setQuery: noop,
            setComposing: noop,
            setResults: noop,
            setCompletedQuery: noop,
            setSearchError: noop,
            setShowDropdown: noop,
            setExpanded: noop,
          }}
          handlers={{
            handleKeyDown: noop,
            selectItem: async () => {},
            selectRecent: noop,
          }}
          navigate={noop}
          t={((key: string) => messages[key] ?? key) as SearchProps["t"]}
        />
      </header>
      <button type="button" data-testid="after-search">
        After search
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TopBarSearchFixture />);
