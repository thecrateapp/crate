import { useState } from "react";
import { MemoryRouter } from "react-router";
import { useTranslation } from "react-i18next";
import { EntityAvatar, EntityRow } from "@crate/ui/domain/entity";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { PageHeader } from "@crate/ui/domain/navigation";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { SelectRow } from "../../../app/listen/src/components/settings/SettingsPrimitives";
import { UserRowView } from "../../../app/listen/src/components/social/UserRowView";
import {
  ProfileCardBody,
  LoadingCard,
  ErrorCard,
} from "../../../app/listen/src/components/social/ProfileHoverCardContent";
import { PeopleContent } from "../../../app/listen/src/pages/PeopleContent";
import { UserConnectionsView } from "../../../app/listen/src/pages/UserConnectionsView";
import { UserProfileReadState } from "../../../app/listen/src/pages/UserProfileReadState";
import { UserProfileView } from "../../../app/listen/src/pages/UserProfileView";
import { UserProfileNetworkView } from "../../../app/listen/src/pages/UserProfileNetworkView";
import { UserProfileLibraryView } from "../../../app/listen/src/pages/UserProfileLibraryView";
import type { PublicProfile } from "../../../app/listen/src/pages/user-profile-model";
import type { UserRowUser } from "../../../app/listen/src/components/social/UserRowView";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
export type CommunityTab = "directory" | "profile" | "connections" | "card";
const profile: PublicProfile = {
  id: 7,
  username: "jane",
  display_name: "Jane Doe",
  avatar: null,
  bio: "Following the thread from post-rock to ambient. Records for late nights and long journeys.",
  joined_at: "2026-01-01T00:00:00Z",
  followers_count: 12,
  following_count: 9,
  friends_count: 3,
  relationship_state: { following: false, followed_by: true, is_friend: false },
  affinity_score: 87,
  affinity_band: "high",
  affinity_reasons: ["3 shared top artists", "Ambient and post-rock"],
  top_genre: { name: "post-rock", play_count: 24, minutes_listened: 80 },
  stats: {
    plays_30d: 126,
    minutes_30d: 640,
    contributions: 8,
    public_playlists: 3,
  },
  badges: [
    { key: "contributor", label: "Contributor", tone: "cyan" },
    { key: "curator", label: "Curator", tone: "gold" },
  ],
  followers_preview: [
    {
      id: 2,
      username: "AnaRecords",
      display_name: "Ana Records",
      avatar: null,
      followed_at: "2026-01-01",
    },
  ],
  following_preview: [
    {
      id: 3,
      username: "marco",
      display_name: "Marco Silva",
      avatar: null,
      followed_at: "2026-01-01",
    },
  ],
  public_playlists: [],
  public_crates: [],
  contributions_preview: [],
};
export function CommunityReview({
  initialTab = "directory",
}: { initialTab?: CommunityTab } = {}) {
  return (
    <MemoryRouter>
      <SettingsFixtureProvider>
        <CommunityScene initialTab={initialTab} />
      </SettingsFixtureProvider>
    </MemoryRouter>
  );
}
function CommunityScene({ initialTab }: { initialTab: CommunityTab }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab),
    [read, setRead] = useState("ready"),
    [own, setOwn] = useState(false),
    [empty, setEmpty] = useState(false),
    [long, setLong] = useState(false),
    [busy, setBusy] = useState(false),
    [following, setFollowing] = useState(false),
    [mode, setMode] = useState<"followers" | "following">("followers"),
    [query, setQuery] = useState("a"),
    [event, setEvent] = useState("No action yet");
  const retry = () => {
    setRead("ready");
    setEvent("Read retried");
  };
  const follow = () => {
    setFollowing((value) => !value);
    setEvent(following ? "Unfollowed Jane" : "Followed Jane");
  };
  const person = {
    ...profile,
    display_name: long
      ? "JaneWithAVeryLongUnbrokenDisplayNameThatMustStayInsideTheProfileAndItsCardWithoutOverflow"
      : profile.display_name,
    bio: long
      ? "A very long public biography, including AnUnbrokenSentenceThatMustWrapOnSmallScreensWithoutPushingActionsOrContentOutsideTheViewport."
      : profile.bio,
    followers_count: empty ? 0 : profile.followers_count,
    following_count: empty ? 0 : profile.following_count,
    friends_count: empty ? 0 : profile.friends_count,
    relationship_state: { following, followed_by: true, is_friend: following },
    affinity_score: empty ? 0 : profile.affinity_score,
    affinity_reasons: empty ? [] : profile.affinity_reasons,
    badges: empty ? [] : profile.badges,
    top_genre: empty ? null : profile.top_genre,
    stats: empty
      ? { plays_30d: 0, minutes_30d: 0, contributions: 0, public_playlists: 0 }
      : profile.stats,
    followers_preview: empty ? [] : profile.followers_preview,
    following_preview: empty ? [] : profile.following_preview,
  };
  const avatar = <EntityAvatar name={person.display_name} size="xl" alt="" />;
  const people = empty
    ? []
    : [person, ...person.followers_preview, ...person.following_preview];
  const renderUser = (user: UserRowUser) => (
    <UserRowView
      title={user.display_name || user.username || "Unknown user"}
      subtitle={user.username ? `@${user.username}` : "No username yet"}
      meta={user.bio || undefined}
      href={`/users/${encodeURIComponent(user.username || "")}`}
      leading={<EntityAvatar name={user.display_name} size="md" alt="" />}
      actionMenu={{
        getActions: () => [
          {
            key: "follow",
            label: "Follow",
            onSelect: () => setEvent(`Followed ${user.display_name}`),
          },
        ],
      }}
      menuLabel="More actions"
    />
  );
  const collectionRows = (kind: "album" | "playlist" | "crate") => (
    <EntityRow
      title={
        kind === "album"
          ? "Luz de octubre"
          : kind === "playlist"
            ? "Night signals"
            : "Records for the road"
      }
      subtitle={kind === "album" ? "Costa Norte" : "A public collection"}
      meta={
        <MonoLabel as="span">
          {kind === "album" ? "Via upload" : "8 tracks · Collaborative"}
        </MonoLabel>
      }
      leading={<MediaCover src={IMAGE_SAMPLES[0]} alt="" className="size-12" />}
      href={
        kind === "album"
          ? "/artists/costa-norte/luz-de-octubre"
          : kind === "playlist"
            ? "/playlist/sample"
            : "/crate/sample"
      }
    />
  );
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-8">
      <MonoLabel
        accent="1BD · Community"
        meta={["Actual Listen views", "Local fixture actions"]}
      />
      <PageHeader
        title="Listeners and connections"
        subtitle="Directory, public profiles, relationships and desktop profile cards. No requests, persisted preferences or account mutations."
      />
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <SelectRow
          label="Read state"
          value={read}
          onChange={setRead}
          options={["ready", "loading", "error"].map((value) => ({
            value,
            label: value,
          }))}
        />
        <SelectRow
          label="Connections"
          value={mode}
          onChange={setMode}
          options={[
            { value: "followers", label: "Followers" },
            { value: "following", label: "Following" },
          ]}
        />
        <FormField layout="inline" label="Own profile">
          <Checkbox
            checked={own}
            onCheckedChange={(value) => setOwn(value === true)}
          />
        </FormField>
        <FormField layout="inline" label="Empty / zero">
          <Checkbox
            checked={empty}
            onCheckedChange={(value) => setEmpty(value === true)}
          />
        </FormField>
        <FormField layout="inline" label="Long content">
          <Checkbox
            checked={long}
            onCheckedChange={(value) => setLong(value === true)}
          />
        </FormField>
        <FormField layout="inline" label="Busy">
          <Checkbox
            checked={busy}
            onCheckedChange={(value) => setBusy(value === true)}
          />
        </FormField>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as CommunityTab)}
      >
        <TabsList aria-label="Community views">
          <TabsTrigger value="directory">People</TabsTrigger>
          <TabsTrigger value="profile">Public profile</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="card">Profile card</TabsTrigger>
        </TabsList>
        <TabsContent value="directory">
          <PeopleContent
            t={t}
            user={{ name: "Record Collector", username: "collector" }}
            data={
              read === "ready"
                ? {
                    followers_count: person.followers_count,
                    following_count: person.following_count,
                    friends_count: person.friends_count,
                    profile: {
                      id: 1,
                      username: "collector",
                      display_name: "Record Collector",
                      avatar: null,
                      bio: null,
                    },
                  }
                : null
            }
            loading={read === "loading"}
            error={read === "error"}
            onRetry={retry}
            query={query}
            onQueryChange={setQuery}
            results={people
              .filter((user) =>
                `${user.display_name} ${user.username}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((user) => ({
                ...user,
                bio: "bio" in user ? user.bio : null,
                joined_at: "2026-01-01",
              }))}
            searching={read === "loading"}
            searchError={read === "error"}
            onSearchRetry={retry}
            renderUser={renderUser}
          />
        </TabsContent>
        <TabsContent value="profile">
          {read !== "ready" ? (
            <UserProfileReadState
              loading={read === "loading"}
              error={read === "error"}
              onRetry={retry}
            />
          ) : (
            <UserProfileView
              data={person}
              avatar={avatar}
              isOwnProfile={own}
              busy={busy}
              onFollowToggle={follow}
              locale="en"
              library={
                <UserProfileLibraryView
                  contributions={empty ? null : collectionRows("album")}
                  playlists={empty ? null : collectionRows("playlist")}
                  crates={empty ? null : collectionRows("crate")}
                />
              }
              network={
                <UserProfileNetworkView data={person} renderUser={renderUser} />
              }
            />
          )}
        </TabsContent>
        <TabsContent value="connections">
          <UserConnectionsView
            username="jane"
            mode={mode}
            data={
              read === "ready"
                ? [...person.followers_preview, ...person.following_preview]
                : null
            }
            loading={read === "loading"}
            error={read === "error"}
            onRetry={retry}
            renderUser={renderUser}
          />
        </TabsContent>
        <TabsContent value="card">
          <div className="isolate flex min-w-0">
            <AppPopover
              layer="popover"
              className="relative w-90 max-w-full p-0"
            >
              {read === "loading" ? (
                <LoadingCard />
              ) : read === "error" ? (
                <ErrorCard onRetry={retry} />
              ) : (
                <ProfileCardBody
                  card={person}
                  avatar={
                    <EntityAvatar name={person.display_name} alt="" size="lg" />
                  }
                  busy={busy}
                  isOwnProfile={own}
                  onFollowToggle={follow}
                />
              )}
            </AppPopover>
          </div>
        </TabsContent>
      </Tabs>
      <MonoLabel role="status">{event}</MonoLabel>
    </main>
  );
}
