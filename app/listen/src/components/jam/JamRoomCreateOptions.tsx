import { Globe2, Lock, Search } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";

import type { JamQueueMode } from "@/pages/jam-reducer";

import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

export function PlaybackModeSelect({
  roomQueueMode,
  onRoomQueueModeChange,
  setRoomPermanent,
}: Pick<
  JamRoomCreatePanelProps,
  "roomQueueMode" | "onRoomQueueModeChange" | "setRoomPermanent"
>) {
  const { t } = useTranslation();

  return (
    <label className="flex flex-col gap-2 text-sm text-text-primary">
      <span className="text-xs uppercase tracking-wide text-text-muted">
        {t("jam.lobby.playbackMode")}
      </span>
      <Select
        value={roomQueueMode}
        onValueChange={(value) => {
          const nextMode = value as JamQueueMode;
          onRoomQueueModeChange(nextMode);
          if (nextMode === "auto_dj") setRoomPermanent(true);
        }}
      >
        <SelectTrigger
          aria-label={t("jam.lobby.playbackMode")}
          className="jam-select-trigger h-11 w-full px-4"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">{t("jam.room.djMode")}</SelectItem>
          <SelectItem value="auto">{t("jam.room.autoMode")}</SelectItem>
          <SelectItem value="auto_dj">{t("jam.room.autoDjMode")}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

export function AutoDjOptions({
  roomGenreFiltersInput,
  setRoomGenreFiltersInput,
  genreSuggestionIndex,
  setGenreSuggestionIndex,
  selectedGenreItems,
  removeGenre,
  genreSuggestions,
  taxonomyLoading,
  selectGenre,
  roomAutoDjVoting,
  setRoomAutoDjVoting,
}: Pick<
  JamRoomCreatePanelProps,
  | "roomGenreFiltersInput"
  | "setRoomGenreFiltersInput"
  | "genreSuggestionIndex"
  | "setGenreSuggestionIndex"
  | "selectedGenreItems"
  | "removeGenre"
  | "genreSuggestions"
  | "taxonomyLoading"
  | "selectGenre"
  | "roomAutoDjVoting"
  | "setRoomAutoDjVoting"
>) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-2">
        <div className="relative">
          <div className="jam-tag-input flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5">
            {selectedGenreItems.map((item) => (
              <GenrePill
                key={item.slug}
                item={item}
                onRemove={() => removeGenre(item.slug || "")}
                removeLabel={t("jam.lobby.removeGenreFilter", {
                  genre: item.name,
                })}
              />
            ))}
            <Search size={16} className="ml-1 shrink-0 text-text-muted" />
            <input
              role="combobox"
              aria-label={t("jam.lobby.genreFiltersPlaceholder")}
              aria-expanded={Boolean(roomGenreFiltersInput.trim())}
              aria-controls="jam-genre-taxonomy-options"
              aria-autocomplete="list"
              value={roomGenreFiltersInput}
              onChange={(event) => {
                setRoomGenreFiltersInput(event.target.value);
                setGenreSuggestionIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && genreSuggestions.length) {
                  event.preventDefault();
                  setGenreSuggestionIndex(
                    (current) => (current + 1) % genreSuggestions.length,
                  );
                } else if (event.key === "ArrowUp" && genreSuggestions.length) {
                  event.preventDefault();
                  setGenreSuggestionIndex(
                    (current) =>
                      (current - 1 + genreSuggestions.length) %
                      genreSuggestions.length,
                  );
                } else if (
                  event.key === "Enter" &&
                  genreSuggestions[genreSuggestionIndex]
                ) {
                  event.preventDefault();
                  selectGenre(genreSuggestions[genreSuggestionIndex]);
                } else if (event.key === "Escape") {
                  setRoomGenreFiltersInput("");
                }
              }}
              placeholder={t("jam.lobby.genreFiltersPlaceholder")}
              className="h-8 min-w-[12rem] flex-1 bg-transparent px-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          {roomGenreFiltersInput.trim() ? (
            <GenreTaxonomyOptions
              genreSuggestions={genreSuggestions}
              taxonomyLoading={taxonomyLoading}
              genreSuggestionIndex={genreSuggestionIndex}
              selectGenre={selectGenre}
            />
          ) : null}
        </div>
        <p className="text-xs text-text-muted">
          {t("jam.lobby.genreFiltersHint")}
        </p>
      </div>
      <label className="jam-toggle-card flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
        <span>{t("jam.lobby.autoDjVoting")}</span>
        <input
          type="checkbox"
          checked={roomAutoDjVoting}
          onChange={(event) => setRoomAutoDjVoting(event.target.checked)}
          className="h-4 w-4 accent-[var(--accent-action)]"
        />
      </label>
    </>
  );
}

function GenreTaxonomyOptions({
  genreSuggestions,
  taxonomyLoading,
  genreSuggestionIndex,
  selectGenre,
}: Pick<
  JamRoomCreatePanelProps,
  | "genreSuggestions"
  | "taxonomyLoading"
  | "genreSuggestionIndex"
  | "selectGenre"
>) {
  const { t } = useTranslation();

  return (
    <div
      id="jam-genre-taxonomy-options"
      role="listbox"
      className="jam-taxonomy-options absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg p-1 shadow-2xl"
    >
      {taxonomyLoading ? (
        <div className="px-3 py-2 text-xs text-text-muted">
          {t("jam.lobby.genreFiltersLoading")}
        </div>
      ) : genreSuggestions.length ? (
        genreSuggestions.map((node, index) => (
          <button
            key={node.slug}
            type="button"
            role="option"
            aria-selected={index === genreSuggestionIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectGenre(node)}
            className="jam-taxonomy-option flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
            data-active={index === genreSuggestionIndex ? "true" : "false"}
          >
            <span className="truncate">{node.name}</span>
            <span className="ml-3 shrink-0 text-xs text-text-muted">
              {node.slug}
            </span>
          </button>
        ))
      ) : (
        <div role="status" className="px-3 py-2 text-xs text-text-muted">
          {t("jam.lobby.genreFiltersNoResults")}
        </div>
      )}
    </div>
  );
}

export function RoomVisibilityOptions({
  roomVisibility,
  setRoomVisibility,
}: Pick<JamRoomCreatePanelProps, "roomVisibility" | "setRoomVisibility">) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => setRoomVisibility("private")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors ${
          roomVisibility === "private" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "private" ? "true" : "false"}
      >
        <Lock size={15} />
        {t("jam.visibility.inviteOnly")}
      </button>
      <button
        type="button"
        onClick={() => setRoomVisibility("public")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors ${
          roomVisibility === "public" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "public" ? "true" : "false"}
      >
        <Globe2 size={15} />
        {t("jam.visibility.public")}
      </button>
    </div>
  );
}
