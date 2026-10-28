import { CatalogSearch } from "../search/CatalogSearch";
import {
  playlistTrackSearchProps,
  type PlaylistTrackSearchView,
} from "./PlaylistTrackSearchView";
export function PlaylistTrackSearch(
  props: Parameters<typeof PlaylistTrackSearchView>[0],
) {
  return <CatalogSearch {...playlistTrackSearchProps(props)} />;
}
