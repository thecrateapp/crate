import {
  CrateAlbumListView,
  CrateAlbumListItem,
  CrateAlbumPreviewRowView,
} from "../../../app/listen/src/components/crates/CrateAlbumListView";
import { CrateAlbumPickerView } from "../../../app/listen/src/components/CrateAlbumPickerView";
import { PlaylistListRowView } from "../../../app/listen/src/components/playlists/PlaylistListRowView";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { PageHeader as SectionPageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "@crate/ui/icons";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { TrackList } from "@crate/ui/domain/tracks";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { formatDuration } from "../../../app/shared/web/utils";
import {
  createContext,
  useContext,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { Link, MemoryRouter } from "react-router";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { PlaylistHeroView } from "../../../app/listen/src/components/playlists/PlaylistHeroView";
import { PlaylistTrackFilterBar } from "../../../app/listen/src/components/playlists/PlaylistTrackFilterBar";
import { PlaylistIdentityView } from "../../../app/listen/src/components/playlists/PlaylistIdentityView";
import { PlaylistComposerTrackListView as PlaylistComposerTrackList } from "../../../app/listen/src/components/playlists/PlaylistComposerTrackListView";
import { PlaylistTrackSearchView as PlaylistTrackSearch } from "../../../app/listen/src/components/playlists/PlaylistTrackSearchView";
import {
  fileToDataUrl,
  toComposerTrack,
  initialPlaylistComposerState,
  playlistComposerReducer,
  getTrackKey,
} from "../../../app/listen/src/components/playlists/playlist-composer-model";
import { CollectionEditorDialog } from "../../../app/listen/src/components/collections/CollectionEditorDialog";
import { CollectionEditorItemRow } from "../../../app/listen/src/components/collections/CollectionEditorItemRow";
import { CollectionMembersDialog } from "../../../app/listen/src/components/collections/CollectionMembersDialog";
import { CollectionMemberRow } from "../../../app/listen/src/components/collections/CollectionMemberRow";
import { CollaboratorSearchView } from "../../../app/listen/src/components/social/CollaboratorSearchView";
import {
  CrateForm,
  crateFormPayload,
  EMPTY_CRATE_FORM_VALUES,
} from "../../../app/listen/src/components/crates/CrateForm";
import { CrateHeroFrame } from "../../../app/listen/src/components/crates/CrateHeroFrame";
import { CrateCoverFlowView } from "../../../app/listen/src/components/crates/CrateCoverFlowView";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { HeroActionBar } from "@crate/ui/domain/hero/HeroActionBar";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { ErrorState, LoadingState, EmptyState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import {
  Play,
  Shuffle,
  Pencil,
  Users,
  ChevronUp,
  ChevronDown,
  Trash2,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const initialTracks = [
  {
    title: "Night music",
    artist: "Chelsea Wolfe",
    album: "A record",
    duration: 183,
    globalTrackUid: "track-a",
    cover: IMAGE_SAMPLES[0],
  },
  {
    title: "Morning",
    artist: "High Vis",
    album: "Another record",
    duration: 225,
    globalTrackUid: "track-b",
    cover: IMAGE_SAMPLES[1],
  },
];
const samplePeople = [
  {
    id: 2,
    username: "DJCase",
    display_name: "Jane McKay",
    avatar: null,
    bio: null,
    joined_at: "2026-01-01",
  },
];
const albums = IMAGE_SAMPLES.slice(0, 3).map((_, index) => ({
  global_album_uid: `album-${index}`,
  position: index,
  displayNumber: index + 1,
  name: ["A record", "Another record", "Night collection"][index]!,
  artist_name: ["Chelsea Wolfe", "High Vis", "Goldie"][index]!,
  has_cover: true,
  year: "2026",
}));
const coverUrl = (album: { global_album_uid: string }) =>
  IMAGE_SAMPLES[Number(album.global_album_uid.split("-")[1])]!;

const DragBinding = createContext<ReturnType<typeof useSortable> | null>(null);
function SortableAlbum({
  uid,
  enabled,
  children,
}: {
  uid: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const sortable = useSortable({ id: uid, disabled: !enabled });
  return (
    <DragBinding.Provider value={sortable}>
      <li
        ref={sortable.setNodeRef}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
      >
        {children}
      </li>
    </DragBinding.Provider>
  );
}
function SceneDragHandle({ name }: { name: string }) {
  const sortable = useContext(DragBinding);
  return (
    <Button
      {...sortable?.attributes}
      {...sortable?.listeners}
      variant="ghost"
      size="icon-lg"
      aria-label={`Drag ${name} to reorder`}
      title="Ordering"
      className="cursor-grab touch-none"
    >
      <GripVertical size={CRATE_ICON_SIZE.md} />
    </Button>
  );
}
function Scene() {
  const [access, setAccess] = useState("owner"),
    [kind, setKind] = useState("playlist"),
    [read, setRead] = useState("ready");
  const [activeTrack, setActiveTrack] = useState<string | null>(null),
    [playing, setPlaying] = useState(false);
  const [event, setEvent] = useState("No action yet"),
    [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"playlist" | "crate" | "members" | null>(
      null,
    ),
    [pending, setPending] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [mode, setMode] = useState("edit");
  const [albumQuery, setAlbumQuery] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [state, dispatch] = useReducer(playlistComposerReducer, {
    ...initialPlaylistComposerState,
    name: "Night collection",
    description: "An editable collection.",
    tracks: initialTracks,
  });
  const [crateValues, setCrateValues] = useState({
    ...EMPTY_CRATE_FORM_VALUES,
    name: "Night collection",
  });
  const [crateItems, setCrateItems] = useState(albums),
    [memberRemoved, setMemberRemoved] = useState(false),
    [personQuery, setPersonQuery] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null),
    descriptionInputRef = useRef<HTMLTextAreaElement>(null),
    fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.titleEditing) titleInputRef.current?.focus();
  }, [state.titleEditing]);
  useEffect(() => {
    if (state.descriptionEditing) descriptionInputRef.current?.focus();
  }, [state.descriptionEditing]);
  const canEdit = access !== "viewer",
    isOwner = access === "owner";
  const collectionTracks = read === "empty" ? [] : initialTracks;
  const collectionAlbums = read === "empty" ? [] : albums;
  const tracks = collectionTracks.filter((track) =>
    `${track.title} ${track.artist}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const actions = (
    <HeroActionBar
      primaryLabel="Playback"
      secondaryLabel="Collection actions"
      primaryActions={[
        {
          key: "play",
          label: "Play",
          disabled: read === "empty",
          icon: <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />,
          onClick: () => setEvent("Play requested"),
        },
        {
          key: "shuffle",
          label: "Shuffle",
          disabled: read === "empty",
          tone: "neutral",
          icon: <Shuffle size={CRATE_ICON_SIZE.md} />,
          onClick: () => setEvent("Shuffle requested"),
        },
      ]}
      secondaryActions={[
        {
          key: "edit",
          label: "Edit",
          disabled: !canEdit,
          icon: <Pencil size={CRATE_ICON_SIZE.lg} />,
          onClick: () => setDialog(kind === "crate" ? "crate" : "playlist"),
        },
        {
          key: "members",
          label: "Collaborators",
          icon: <Users size={CRATE_ICON_SIZE.lg} />,
          onClick: () => setDialog("members"),
        },
      ]}
    />
  );
  async function submit(label: string) {
    setPending(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setPending(false);
    setDialog(null);
    setEvent(label);
  }
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BB · details and editors · review"
        title="Playlists and crates"
        subtitle="Actual production presentation views. Local fixtures; transport, permissions, API and playback stay in the app controllers."
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Access">
          {(control) => (
            <Select value={access} onValueChange={setAccess}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["owner", "collaborator", "viewer"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Read state">
          {(control) => (
            <Select value={read} onValueChange={setRead}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ready", "loading", "error", "empty"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      <Tabs value={kind} onValueChange={setKind}>
        <TabsList aria-label="Detail surface">
          {["playlist", "curated", "generated", "crate", "section"].map(
            (value) => (
              <TabsTrigger key={value} value={value}>
                {value}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        {["playlist", "curated", "generated", "crate", "section"].map(
          (value) => (
            <TabsContent key={value} value={value}>
              {kind === value &&
                (read === "loading" ? (
                  <LoadingState label="Loading collection" />
                ) : read === "error" ? (
                  <ErrorState
                    message="Collection read failed"
                    retryLabel="Retry"
                    onRetry={() => setRead("ready")}
                  />
                ) : (
                  <>
                    {kind === "section" ? (
                      <SectionPageHeader
                        title="Recommended tracks"
                        subtitle="Home section detail"
                      />
                    ) : kind === "crate" ? (
                      <CrateHeroFrame
                        title="Night collection"
                        owner={<span>Jane McKay</span>}
                        description="A crate with its original V2 coverflow geometry."
                        metaItems={[
                          <MonoLabel key="count" as="span">
                            {collectionAlbums.length} albums
                          </MonoLabel>,
                        ]}
                        actions={actions}
                        renderBackground={(className) => (
                          <img
                            src={IMAGE_SAMPLES[0]}
                            alt=""
                            className={className}
                          />
                        )}
                        artwork={
                          <CrateCoverFlowView
                            albums={collectionAlbums}
                            crateName="Night collection"
                            isOrdered
                            loopEnabled
                            coverUrl={coverUrl}
                            onPlayAlbum={(album) =>
                              setEvent(`Play ${album.name} requested`)
                            }
                            playableAlbumUids={
                              new Set(
                                albums.map((album) => album.global_album_uid),
                              )
                            }
                            renderCover={(image, album) => (
                              <img
                                src={image.src}
                                alt={album?.name || ""}
                                width={image.width}
                                height={image.height}
                                className={image.className}
                                draggable={image.draggable}
                                sizes={image.sizes}
                                loading={image.loading}
                              />
                            )}
                          />
                        }
                      />
                    ) : (
                      <PlaylistHeroView
                        title="Night collection"
                        description="A collection of records for the evening."
                        metaItems={[
                          `${collectionTracks.length} tracks`,
                          ...(collectionTracks.length ? ["6 min"] : []),
                          kind === "generated"
                            ? "Generated for you"
                            : kind === "curated"
                              ? "Editorial"
                              : "Private playlist",
                        ]}
                        badges={<InfoBadge>{kind}</InfoBadge>}
                        artwork={(className) => (
                          <MediaCover
                            src={IMAGE_SAMPLES[0]}
                            alt=""
                            className={className}
                          />
                        )}
                        actions={actions}
                      />
                    )}
                    <div className="space-y-4">
                      {kind !== "crate" && (
                        <PlaylistTrackFilterBar
                          query={filter}
                          onQueryChange={setFilter}
                          totalCount={collectionTracks.length}
                          filteredCount={tracks.length}
                        />
                      )}
                      {kind === "crate" ? (
                        <CrateAlbumListView count={collectionAlbums.length}>
                          {collectionAlbums.map((album) => (
                            <CrateAlbumListItem key={album.global_album_uid}>
                              {access === "viewer" ? (
                                <CrateAlbumPreviewRowView
                                  title={album.name}
                                  artist={album.artist_name}
                                  year={album.year}
                                  rank={album.displayNumber}
                                  artwork={
                                    <MediaCover
                                      src={coverUrl(album)}
                                      alt=""
                                      className="size-12"
                                    />
                                  }
                                />
                              ) : (
                                <EntityRow
                                  title={album.name}
                                  subtitle={`${album.artist_name} · ${album.year}`}
                                  rank={album.displayNumber}
                                  leading={
                                    <MediaCover
                                      src={coverUrl(album)}
                                      alt=""
                                      className="size-12"
                                    />
                                  }
                                  onOpen={() =>
                                    setEvent(`Open ${album.name} requested`)
                                  }
                                />
                              )}
                            </CrateAlbumListItem>
                          ))}
                        </CrateAlbumListView>
                      ) : read === "empty" || tracks.length === 0 ? (
                        <EmptyState message="No matching items" />
                      ) : (
                        <TrackList
                          items={tracks}
                          itemKey={(track) => track.globalTrackUid}
                          renderRow={(track, index) => {
                            const active = activeTrack === track.globalTrackUid;
                            const play = () => {
                              setActiveTrack(track.globalTrackUid);
                              setPlaying(!active || !playing);
                              setEvent(`Play ${track.title} requested`);
                            };
                            return (
                              <TrackRowView
                                aria-label={track.title}
                                active={active}
                                onClick={play}
                                onKeyDown={(event) => {
                                  if (
                                    event.target === event.currentTarget &&
                                    ["Enter", " "].includes(event.key)
                                  ) {
                                    event.preventDefault();
                                    play();
                                  }
                                }}
                              >
                                <TrackRowContent
                                  title={track.title}
                                  details={track.artist}
                                  duration={formatDuration(track.duration)}
                                  actions={null}
                                  leading={
                                    <TrackRowPlaybackControl
                                      index={index + 1}
                                      disabled={false}
                                      isActive={active}
                                      isPlaying={playing}
                                      label={`${active && playing ? "Pause" : "Play"} ${track.title}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        play();
                                      }}
                                      artwork={
                                        <MediaCover
                                          src={IMAGE_SAMPLES[index]}
                                          alt=""
                                          className="absolute inset-0 size-full"
                                        />
                                      }
                                      activeGlyph={
                                        active ? (
                                          <TrackRowPlaybackProgressView
                                            isPlaying={playing}
                                            currentTime={12}
                                            duration={track.duration}
                                          />
                                        ) : undefined
                                      }
                                    />
                                  }
                                />
                              </TrackRowView>
                            );
                          }}
                        />
                      )}
                    </div>
                  </>
                ))}
            </TabsContent>
          ),
        )}
      </Tabs>
      <FormField label="Editor mode">
        {(control) => (
          <Select
            value={mode}
            onValueChange={(value) => {
              setMode(value);
              if (value === "create") {
                dispatch({
                  type: "reset",
                  initialName: "",
                  initialDescription: "",
                  initialCoverDataUrl: null,
                  initialVisibility: "private",
                  initialCollaborative: false,
                  initialTracks: [],
                });
                setCrateValues(EMPTY_CRATE_FORM_VALUES);
              }
            }}
          >
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="edit">Edit</SelectItem>
              <SelectItem value="create">Create</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>
      <SectionHeader title="Collection playlist row" />
      <PlaylistListRowView
        offlineState="idle"
        title="Evening playlist"
        subtitle={<MonoLabel as="span">2 tracks</MonoLabel>}
        leading={
          <MediaCover src={IMAGE_SAMPLES[0]} alt="" className="size-12" />
        }
        onOpen={() => setEvent("Open Evening playlist requested")}
      />
      <div className="flex flex-wrap gap-3">
        <Button disabled={!canEdit} onClick={() => setDialog("playlist")}>
          Open playlist editor
        </Button>
        <Button disabled={!canEdit} onClick={() => setDialog("crate")}>
          Open crate editor
        </Button>
        <Button variant="secondary" onClick={() => setDialog("members")}>
          Open collaborators
        </Button>
      </div>
      <output
        aria-label="Fixture action"
        aria-live="polite"
        className="block wrap-anywhere"
      >
        {event}
      </output>
      <CollectionEditorDialog
        open={dialog === "playlist"}
        title={mode === "create" ? "Create playlist" : "Edit playlist"}
        formId="review-playlist"
        submitLabel="Save changes"
        cancelLabel="Cancel"
        closeLabel="Close"
        pending={pending}
        submitDisabled={!state.name.trim()}
        onCancel={() => setDialog(null)}
      >
        <form
          id="review-playlist"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(`Playlist saved: ${state.name.trim()}`);
          }}
          className="space-y-5"
        >
          <PlaylistIdentityView
            state={state}
            refs={{ titleInputRef, descriptionInputRef, fileInputRef }}
            dispatch={dispatch}
            t={i18n.t}
            canManageSettings={isOwner || mode === "create"}
            handleFileChange={async (event) => {
              const file = event.target.files?.[0];
              if (file)
                dispatch({
                  type: "set-cover",
                  value: await fileToDataUrl(file),
                });
              event.target.value = "";
            }}
            artwork={
              <MediaCover
                src={state.coverDataUrl || IMAGE_SAMPLES[0]}
                alt=""
                className="size-24 sm:size-28"
              />
            }
          />
          <PlaylistTrackSearch
            search={state.search}
            searching={false}
            results={
              state.search
                ? [
                    {
                      title: "New track",
                      artist: "Goldie",
                      album: "A record",
                      duration: 180,
                      global_track_uid: "track-c",
                      cover: IMAGE_SAMPLES[2],
                    },
                  ]
                : []
            }
            t={i18n.t}
            onSearchChange={(value) => dispatch({ type: "set-search", value })}
            onAddTrack={(track) =>
              dispatch({
                type: "add-track",
                value: toComposerTrack(track),
              })
            }
          />
          <PlaylistComposerTrackList
            tracks={state.tracks}
            t={i18n.t}
            onRemove={(track) =>
              dispatch({ type: "remove-track", key: getTrackKey(track) })
            }
            onDragEnd={({ active, over }) => {
              if (over)
                dispatch({
                  type: "move-track",
                  activeId: String(active.id),
                  overId: String(over.id),
                });
            }}
          />
        </form>
      </CollectionEditorDialog>
      <CollectionEditorDialog
        open={dialog === "crate"}
        title={mode === "create" ? "Create crate" : "Edit crate"}
        size="xl"
        closeBlocked={deleteConfirm}
        formId="review-crate"
        submitLabel="Save changes"
        cancelLabel="Cancel"
        closeLabel="Close"
        pending={pending}
        submitDisabled={!crateValues.name.trim()}
        onCancel={() => setDialog(null)}
      >
        <CrateForm
          id="review-crate"
          values={crateValues}
          isOwner={isOwner || mode === "create"}
          onChange={(patch) =>
            setCrateValues((current) => ({ ...current, ...patch }))
          }
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              `Crate saved: ${JSON.stringify(crateFormPayload(crateValues, isOwner))}`,
            );
          }}
        />
        {mode !== "create" ? (
          <>
            <SectionHeader
              title="Albums"
              action={<MonoLabel>{crateItems.length} albums</MonoLabel>}
            />
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (over)
                  setCrateItems((items) =>
                    arrayMove(
                      items,
                      items.findIndex(
                        (item) => item.global_album_uid === active.id,
                      ),
                      items.findIndex(
                        (item) => item.global_album_uid === over.id,
                      ),
                    ),
                  );
              }}
            >
              <SortableContext
                items={crateItems.map((item) => item.global_album_uid)}
                strategy={verticalListSortingStrategy}
              >
                <ul>
                  {crateItems.map((album, index) => (
                    <SortableAlbum
                      key={album.global_album_uid}
                      uid={album.global_album_uid}
                      enabled={crateValues.ordering !== "none"}
                    >
                      <CollectionEditorItemRow
                        title={album.name}
                        subtitle={album.artist_name}
                        artwork={
                          <MediaCover
                            src={coverUrl(album)}
                            alt=""
                            className="size-12"
                          />
                        }
                        dragHandle={
                          crateValues.ordering !== "none" ? (
                            <SceneDragHandle name={album.name} />
                          ) : undefined
                        }
                        meta={<MonoLabel as="span">{album.year}</MonoLabel>}
                        reorderControls={
                          crateValues.ordering !== "none" ? (
                            <ActionGroup label="Ordering">
                              <ActionButton
                                label={`Move ${album.name} up`}
                                tooltip="Up"
                                disabled={index === 0}
                                onClick={() =>
                                  setCrateItems((items) => {
                                    const next = [...items];
                                    [next[index - 1], next[index]] = [
                                      next[index]!,
                                      next[index - 1]!,
                                    ];
                                    return next;
                                  })
                                }
                              >
                                <ChevronUp size={CRATE_ICON_SIZE.md} />
                              </ActionButton>
                              <ActionButton
                                label={`Move ${album.name} down`}
                                tooltip="Down"
                                disabled={index === crateItems.length - 1}
                                onClick={() =>
                                  setCrateItems((items) => {
                                    const next = [...items];
                                    [next[index], next[index + 1]] = [
                                      next[index + 1]!,
                                      next[index]!,
                                    ];
                                    return next;
                                  })
                                }
                              >
                                <ChevronDown size={CRATE_ICON_SIZE.md} />
                              </ActionButton>
                            </ActionGroup>
                          ) : undefined
                        }
                        actions={
                          <ActionButton
                            label={`Remove ${album.name}`}
                            tooltip="Remove"
                            onClick={() =>
                              setCrateItems((items) =>
                                items.filter(
                                  (item) =>
                                    item.global_album_uid !==
                                    album.global_album_uid,
                                ),
                              )
                            }
                          >
                            <Trash2 size={CRATE_ICON_SIZE.md} />
                          </ActionButton>
                        }
                      />
                    </SortableAlbum>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <CrateAlbumPickerView
              query={albumQuery}
              onQueryChange={setAlbumQuery}
              onSearch={(event) => event.preventDefault()}
              results={
                albumQuery
                  ? [
                      {
                        name: "New record",
                        artist: "Goldie",
                        year: "2026",
                        global_album_uid: "album-3",
                      },
                    ]
                  : []
              }
              searching={false}
              addingUid={null}
              error={false}
              existingAlbumUids={
                new Set(crateItems.map((album) => album.global_album_uid))
              }
              coverUrl={() => IMAGE_SAMPLES[0]!}
              onRetry={() => {}}
              onAdd={() => {
                setCrateItems((items) => [
                  ...items,
                  {
                    ...albums[0]!,
                    global_album_uid: "album-3",
                    name: "New record",
                  },
                ]);
                setAlbumQuery("");
              }}
            />
          </>
        ) : null}
        {isOwner && mode === "edit" ? (
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirm(true)}>
              Delete crate
            </Button>
            <ConfirmDialog
              open={deleteConfirm}
              title="Delete crate?"
              body="Remove this fixture collection?"
              tone="danger"
              confirmLabel="Delete"
              cancelLabel="Cancel"
              closeLabel="Close"
              pending={pending}
              onCancel={() => setDeleteConfirm(false)}
              onConfirm={async () => {
                setDeleteConfirm(false);
                await submit("Crate deleted in fixture");
              }}
            />
          </>
        ) : null}
      </CollectionEditorDialog>
      <CollectionMembersDialog
        open={dialog === "members"}
        title="Collaborators"
        description="Owner and self restrictions stay in the actual app controllers."
        closeLabel="Close"
        onClose={() => setDialog(null)}
        closeBlocked={leaveConfirm}
      >
        <CollectionMemberRow
          name="Listener"
          handle="@Listener"
          roleLabel="Owner"
        />
        {!memberRemoved ? (
          <CollectionMemberRow
            name="Jane McKay"
            nameContent={<Link to="/users/DJCase">Jane McKay</Link>}
            handle="@DJCase"
            roleLabel="Collaborator"
            removeLabel="Remove Jane McKay"
            onRemove={isOwner ? () => setMemberRemoved(true) : undefined}
          />
        ) : null}
        {isOwner ? (
          <CollaboratorSearchView
            query={personQuery}
            onQueryChange={setPersonQuery}
            searching={false}
            candidates={personQuery && memberRemoved ? samplePeople : []}
            addingUserId={null}
            onAdd={() => {
              setMemberRemoved(false);
              setPersonQuery("");
              setEvent("Collaborator added in fixture");
            }}
          />
        ) : null}
        {access === "collaborator" ? (
          <Button variant="ghost" onClick={() => setLeaveConfirm(true)}>
            Leave collection
          </Button>
        ) : null}
        <ConfirmDialog
          open={leaveConfirm}
          title="Leave collection?"
          body="This only changes local review state."
          confirmLabel="Leave"
          cancelLabel="Cancel"
          closeLabel="Close"
          pending={pending}
          onCancel={() => setLeaveConfirm(false)}
          onConfirm={async () => {
            setPending(true);
            await new Promise((resolve) => setTimeout(resolve, 400));
            setPending(false);
            setLeaveConfirm(false);
            setDialog(null);
            setEvent("Left collection in fixture");
          }}
        />
      </CollectionMembersDialog>
    </main>
  );
}
export function CollectionDetailsReview() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Scene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
