import { CRATE_ICON_SIZE, Loader2, Pin, Radio } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import {
  PlaybackModeSelect,
  RoomVisibilityOptions,
} from "./JamRoomCreateOptions";
import { AutoDjOptions } from "./JamRoomAutoDjOptions";
import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

const JAM_FIELD_CLASS_NAME =
  "jam-input rounded-lg px-4 shadow-none backdrop-blur-none placeholder:text-text-muted md:text-base";

export function JamRoomCreatePanel({
  roomName,
  setRoomName,
  roomDescription,
  setRoomDescription,
  roomTagsInput,
  setRoomTagsInput,
  roomQueueMode,
  onRoomQueueModeChange,
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
  roomVisibility,
  setRoomVisibility,
  roomPermanent,
  setRoomPermanent,
  creating,
  onCreateRoom,
}: JamRoomCreatePanelProps) {
  const { t } = useTranslation();

  return (
    <section className="jam-panel rounded-[12px] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.lobby.startTitle")}
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {t("jam.lobby.startSubtitle")}
      </p>
      <div className="mt-4 space-y-3">
        <Input
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          placeholder={t("jam.lobby.namePlaceholder")}
          aria-label={t("jam.lobby.namePlaceholder")}
          className={`${JAM_FIELD_CLASS_NAME} placeholder:text-text-primary/40`}
        />
        <Textarea
          value={roomDescription}
          onChange={(event) => setRoomDescription(event.target.value)}
          placeholder={t("jam.lobby.descriptionPlaceholder")}
          aria-label={t("jam.lobby.descriptionPlaceholder")}
          rows={3}
          className={`${JAM_FIELD_CLASS_NAME} min-h-0 resize-none py-3`}
        />
        <Input
          value={roomTagsInput}
          onChange={(event) => setRoomTagsInput(event.target.value)}
          placeholder={t("jam.lobby.tagsPlaceholder")}
          aria-label={t("jam.lobby.tagsPlaceholder")}
          className={JAM_FIELD_CLASS_NAME}
        />
        <PlaybackModeSelect
          roomQueueMode={roomQueueMode}
          onRoomQueueModeChange={onRoomQueueModeChange}
          setRoomPermanent={setRoomPermanent}
        />
        {roomQueueMode === "auto_dj" ? (
          <AutoDjOptions
            roomGenreFiltersInput={roomGenreFiltersInput}
            setRoomGenreFiltersInput={setRoomGenreFiltersInput}
            genreSuggestionIndex={genreSuggestionIndex}
            setGenreSuggestionIndex={setGenreSuggestionIndex}
            selectedGenreItems={selectedGenreItems}
            removeGenre={removeGenre}
            genreSuggestions={genreSuggestions}
            taxonomyLoading={taxonomyLoading}
            selectGenre={selectGenre}
            roomAutoDjVoting={roomAutoDjVoting}
            setRoomAutoDjVoting={setRoomAutoDjVoting}
          />
        ) : null}
        <RoomVisibilityOptions
          roomVisibility={roomVisibility}
          setRoomVisibility={setRoomVisibility}
        />
        <label className="jam-toggle-option flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
          <span className="inline-flex items-center gap-2">
            <Pin size={CRATE_ICON_SIZE.sm} className="jam-accent-text" />
            {t("jam.lobby.permanentRoom")}
          </span>
          <Checkbox
            checked={roomPermanent}
            onCheckedChange={(checked) => setRoomPermanent(checked === true)}
            className="size-4"
          />
        </label>
        <Button
          type="button"
          onClick={onCreateRoom}
          disabled={creating}
          className="h-auto rounded-lg px-4 py-2.5 shadow-none hover:bg-accent-action/90 disabled:opacity-60 [&_svg:not([class*='size-'])]:size-4 has-[>svg]:px-4"
        >
          {creating ? (
            <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
          ) : (
            <Radio size={CRATE_ICON_SIZE.sm} />
          )}
          {t("jam.lobby.createRoom")}
        </Button>
      </div>
    </section>
  );
}
