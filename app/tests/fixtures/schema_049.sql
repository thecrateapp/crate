--
-- PostgreSQL database dump
--


-- Dumped from database version 15.18 (Debian 15.18-1.pgdg12+1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: library_albums_search_cascade(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.library_albums_search_cascade() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            IF NEW.name IS DISTINCT FROM OLD.name THEN
                UPDATE library_tracks
                SET search_vector = DEFAULT
                WHERE album_id = NEW.id;
            END IF;
            RETURN NEW;
        END;
        $$;


--
-- Name: library_albums_search_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.library_albums_search_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(NEW.artist, '')), 'B');
            RETURN NEW;
        END;
        $$;


--
-- Name: library_artists_search_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.library_artists_search_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A');
            RETURN NEW;
        END;
        $$;


--
-- Name: library_tracks_search_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.library_tracks_search_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        DECLARE
            album_name_text TEXT;
        BEGIN
            SELECT name INTO album_name_text
            FROM library_albums
            WHERE id = NEW.album_id;

            NEW.search_vector :=
                setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(NEW.artist, '')), 'B') ||
                setweight(to_tsvector('simple', coalesce(album_name_text, NEW.album, '')), 'C');
            RETURN NEW;
        END;
        $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: album_genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_genres (
    album_id integer NOT NULL,
    genre_id integer NOT NULL,
    weight double precision DEFAULT 1.0,
    source text DEFAULT 'tags'::text
);


--
-- Name: album_portable_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_portable_metadata (
    album_id integer NOT NULL,
    album_entity_uid uuid,
    sidecar_path text,
    sidecar_written_at timestamp with time zone,
    audio_tags_written_at timestamp with time zone,
    tracks integer DEFAULT 0 NOT NULL,
    tags_written integer DEFAULT 0 NOT NULL,
    tag_errors integer DEFAULT 0 NOT NULL,
    export_path text,
    exported_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: artist_bliss_centroids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_bliss_centroids (
    artist_id bigint NOT NULL,
    artist_name text NOT NULL,
    track_count integer DEFAULT 0 NOT NULL,
    bliss_vector double precision[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artist_genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_genres (
    artist_name text NOT NULL,
    genre_id integer NOT NULL,
    weight double precision DEFAULT 1.0,
    source text DEFAULT 'tags'::text
);


--
-- Name: artist_similarities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_similarities (
    id integer NOT NULL,
    artist_name text NOT NULL,
    similar_name text NOT NULL,
    score real DEFAULT 0,
    source text DEFAULT 'lastfm'::text,
    in_library boolean DEFAULT false,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: artist_similarities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_similarities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_similarities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_similarities_id_seq OWNED BY public.artist_similarities.id;


--
-- Name: artist_suggestion_supporters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_suggestion_supporters (
    suggestion_id bigint NOT NULL,
    user_id integer NOT NULL,
    artist_url text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artist_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_suggestions (
    id bigint NOT NULL,
    artist_name text NOT NULL,
    normalized_artist_name text NOT NULL,
    artist_url text,
    note text,
    status text DEFAULT 'new'::text NOT NULL,
    created_by_user_id integer,
    triaged_by_user_id integer,
    linked_artist_id integer,
    linked_task_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT artist_suggestions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'searching'::text, 'accepted'::text, 'dismissed'::text, 'downloaded'::text])))
);


--
-- Name: artist_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_suggestions_id_seq OWNED BY public.artist_suggestions.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_name text NOT NULL,
    details_json jsonb DEFAULT '{}'::jsonb,
    user_id integer,
    task_id text
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auth_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_invites (
    token text NOT NULL,
    email text,
    created_by integer,
    expires_at timestamp with time zone,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone
);


--
-- Name: bandcamp_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_connections (
    id integer NOT NULL,
    user_id integer NOT NULL,
    username text,
    fan_id bigint,
    display_name text,
    image_url text,
    status text DEFAULT 'connected'::text NOT NULL,
    session_secret_ref text NOT NULL,
    session_fingerprint text NOT NULL,
    password_secret_ref text,
    connection_method text NOT NULL,
    last_sync_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error text,
    sync_cursor_json jsonb DEFAULT '{}'::jsonb,
    settings_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: bandcamp_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandcamp_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandcamp_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandcamp_connections_id_seq OWNED BY public.bandcamp_connections.id;


--
-- Name: bandcamp_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_imports (
    id integer NOT NULL,
    user_id integer NOT NULL,
    connection_id integer,
    bandcamp_item_id integer NOT NULL,
    task_id text,
    requested_format text DEFAULT 'flac'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    imported_artist_uid uuid,
    imported_album_uid uuid,
    imported_track_uids uuid[] DEFAULT '{}'::uuid[],
    source_archive_url text,
    source_archive_sha256 text,
    error text,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: bandcamp_imports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandcamp_imports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandcamp_imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandcamp_imports_id_seq OWNED BY public.bandcamp_imports.id;


--
-- Name: bandcamp_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_items (
    id integer NOT NULL,
    bandcamp_item_id bigint,
    bandcamp_item_type text NOT NULL,
    band_id bigint,
    album_id bigint,
    track_id bigint,
    art_id bigint,
    artist_name text,
    album_title text,
    track_title text,
    label_name text,
    item_url text NOT NULL,
    artist_url text,
    album_url text,
    cover_url text,
    release_date date,
    tags_json jsonb DEFAULT '[]'::jsonb,
    raw_json jsonb DEFAULT '{}'::jsonb,
    first_seen_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: bandcamp_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandcamp_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandcamp_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandcamp_items_id_seq OWNED BY public.bandcamp_items.id;


--
-- Name: bandcamp_library_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_library_matches (
    id integer NOT NULL,
    bandcamp_item_id integer NOT NULL,
    entity_type text NOT NULL,
    entity_uid uuid NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    source text NOT NULL,
    evidence_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: bandcamp_library_matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandcamp_library_matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandcamp_library_matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandcamp_library_matches_id_seq OWNED BY public.bandcamp_library_matches.id;


--
-- Name: bandcamp_pairing_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_pairing_challenges (
    pairing_id text NOT NULL,
    user_id integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    connection_method text NOT NULL,
    task_id text,
    result_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: bandcamp_radar_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandcamp_radar_items (
    id integer NOT NULL,
    user_id integer,
    bandcamp_item_id integer,
    scope text NOT NULL,
    source text NOT NULL,
    score double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    reason_json jsonb DEFAULT '{}'::jsonb,
    first_seen_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: bandcamp_radar_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandcamp_radar_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandcamp_radar_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandcamp_radar_items_id_seq OWNED BY public.bandcamp_radar_items.id;


--
-- Name: cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache (
    key text NOT NULL,
    value_json jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: cast_stream_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cast_stream_tickets (
    ticket_hash text NOT NULL,
    ticket_id text NOT NULL,
    user_id integer NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_path text,
    purpose text NOT NULL,
    target_device_id text,
    delivery_policy text DEFAULT 'balanced'::text NOT NULL,
    receiver_capabilities_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone
);


--
-- Name: connect_command_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connect_command_outbox (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    target_device_id text NOT NULL,
    command_id uuid NOT NULL,
    command_type text NOT NULL,
    source_device_id text,
    playback_session_id uuid,
    command_seq bigint,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    delivered_at timestamp with time zone,
    acked_at timestamp with time zone,
    ack_status text,
    ack_error text
);


--
-- Name: connect_command_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.connect_command_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: connect_command_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.connect_command_outbox_id_seq OWNED BY public.connect_command_outbox.id;


--
-- Name: credential_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credential_secrets (
    secret_ref text NOT NULL,
    scope text NOT NULL,
    ciphertext text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: dir_mtimes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dir_mtimes (
    path text NOT NULL,
    mtime double precision NOT NULL,
    data_json jsonb
);


--
-- Name: entity_identity_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_identity_keys (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_uid uuid NOT NULL,
    key_type text NOT NULL,
    key_value text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entity_identity_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entity_identity_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entity_identity_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entity_identity_keys_id_seq OWNED BY public.entity_identity_keys.id;


--
-- Name: equalizer_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equalizer_presets (
    id bigint NOT NULL,
    scope text NOT NULL,
    target_type text NOT NULL,
    target_entity_uid uuid NOT NULL,
    user_id integer,
    gains double precision[] NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    reasoning text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equalizer_presets_check CHECK ((((scope = 'user'::text) AND (user_id IS NOT NULL)) OR ((scope = 'instance'::text) AND (user_id IS NULL)))),
    CONSTRAINT equalizer_presets_scope_check CHECK ((scope = ANY (ARRAY['user'::text, 'instance'::text]))),
    CONSTRAINT equalizer_presets_target_type_check CHECK ((target_type = ANY (ARRAY['track'::text, 'album'::text])))
);


--
-- Name: equalizer_presets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equalizer_presets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equalizer_presets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equalizer_presets_id_seq OWNED BY public.equalizer_presets.id;


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id integer NOT NULL,
    item_type text NOT NULL,
    item_id text NOT NULL,
    user_id integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.favorites_id_seq OWNED BY public.favorites.id;


--
-- Name: genre_taxonomy_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genre_taxonomy_aliases (
    alias_slug text NOT NULL,
    alias_name text NOT NULL,
    genre_id integer NOT NULL
);


--
-- Name: genre_taxonomy_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genre_taxonomy_edges (
    source_genre_id integer NOT NULL,
    target_genre_id integer NOT NULL,
    relation_type text NOT NULL,
    weight double precision DEFAULT 1.0 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    confidence double precision DEFAULT 1.0 NOT NULL,
    evidence_json jsonb,
    created_by integer,
    locked boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: genre_taxonomy_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genre_taxonomy_nodes (
    id integer NOT NULL,
    entity_uid uuid,
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    external_description text DEFAULT ''::text NOT NULL,
    external_description_source text DEFAULT ''::text NOT NULL,
    cover_path text,
    musicbrainz_mbid text,
    wikidata_entity_id text,
    wikidata_url text,
    is_top_level boolean DEFAULT false NOT NULL,
    eq_gains double precision[],
    eq_reasoning text
);


--
-- Name: genre_taxonomy_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.genre_taxonomy_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: genre_taxonomy_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.genre_taxonomy_nodes_id_seq OWNED BY public.genre_taxonomy_nodes.id;


--
-- Name: genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genres (
    id integer NOT NULL,
    entity_uid uuid,
    name text NOT NULL,
    slug text NOT NULL
);


--
-- Name: genres_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.genres_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: genres_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.genres_id_seq OWNED BY public.genres.id;


--
-- Name: health_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_issues (
    id integer NOT NULL,
    check_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    description text NOT NULL,
    details_json jsonb DEFAULT '{}'::jsonb,
    auto_fixable boolean DEFAULT false,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: health_issues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_issues_id_seq OWNED BY public.health_issues.id;


--
-- Name: i18n_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.i18n_bundles (
    id uuid NOT NULL,
    app text NOT NULL,
    locale text NOT NULL,
    source_locale text DEFAULT 'en'::text NOT NULL,
    source_version text NOT NULL,
    bundle_version text NOT NULL,
    status text NOT NULL,
    messages_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: i18n_translation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.i18n_translation_requests (
    id uuid NOT NULL,
    app text NOT NULL,
    locale text NOT NULL,
    source_version text NOT NULL,
    client text,
    reason text NOT NULL,
    status text NOT NULL,
    task_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: import_queue_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_queue_items (
    id bigint NOT NULL,
    source text DEFAULT 'filesystem'::text NOT NULL,
    path text NOT NULL,
    artist text,
    album text,
    status text DEFAULT 'pending'::text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: import_queue_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_queue_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_queue_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_queue_items_id_seq OWNED BY public.import_queue_items.id;


--
-- Name: jam_room_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jam_room_events (
    id bigint NOT NULL,
    room_id uuid NOT NULL,
    user_id integer,
    event_type text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: jam_room_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jam_room_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jam_room_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jam_room_events_id_seq OWNED BY public.jam_room_events.id;


--
-- Name: jam_room_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jam_room_invites (
    token text NOT NULL,
    room_id uuid NOT NULL,
    created_by integer,
    expires_at timestamp with time zone,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: jam_room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jam_room_members (
    room_id uuid NOT NULL,
    user_id integer NOT NULL,
    role text DEFAULT 'collab'::text NOT NULL,
    joined_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone
);


--
-- Name: jam_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jam_rooms (
    id uuid NOT NULL,
    host_user_id integer NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    is_permanent boolean DEFAULT false NOT NULL,
    description text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_track_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: library_albums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_albums (
    id integer NOT NULL,
    storage_id uuid,
    entity_uid uuid,
    artist text NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    track_count integer DEFAULT 0,
    total_size bigint DEFAULT 0,
    total_duration double precision DEFAULT 0,
    formats_json jsonb DEFAULT '[]'::jsonb,
    year text,
    genre text,
    has_cover integer DEFAULT 0,
    musicbrainz_albumid text,
    dir_mtime double precision,
    updated_at timestamp with time zone,
    slug text,
    tag_album text,
    musicbrainz_releasegroupid text,
    discogs_master_id text,
    lastfm_listeners integer,
    lastfm_playcount bigint,
    popularity integer,
    bandcamp_url text,
    bandcamp_url_source text,
    bandcamp_url_updated_at timestamp with time zone,
    search_vector tsvector,
    popularity_score double precision,
    popularity_confidence double precision,
    quarantined_at timestamp with time zone,
    quarantine_task_id text
);


--
-- Name: library_albums_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.library_albums_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: library_albums_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.library_albums_id_seq OWNED BY public.library_albums.id;


--
-- Name: library_artists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.library_artists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: library_artists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_artists (
    name text NOT NULL,
    album_count integer DEFAULT 0,
    track_count integer DEFAULT 0,
    total_size bigint DEFAULT 0,
    formats_json jsonb DEFAULT '[]'::jsonb,
    primary_format text,
    has_photo integer DEFAULT 0,
    dir_mtime double precision,
    updated_at timestamp with time zone,
    id bigint DEFAULT nextval('public.library_artists_id_seq'::regclass),
    storage_id uuid,
    entity_uid uuid,
    slug text,
    folder_name text,
    bio text,
    tags_json jsonb,
    similar_json jsonb,
    spotify_id text,
    spotify_popularity integer,
    mbid text,
    country text,
    area text,
    formed text,
    ended text,
    artist_type text,
    members_json jsonb,
    urls_json jsonb,
    listeners integer,
    enriched_at timestamp with time zone,
    discogs_id text,
    spotify_followers integer,
    lastfm_playcount bigint,
    discogs_profile text,
    discogs_members_json jsonb,
    latest_release_date text,
    new_releases_checked_at timestamp with time zone,
    content_hash text,
    bandcamp_url text,
    bandcamp_url_source text,
    bandcamp_url_updated_at timestamp with time zone,
    search_vector tsvector,
    popularity integer,
    popularity_score double precision,
    popularity_confidence double precision
);


--
-- Name: library_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_contributions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    source text NOT NULL,
    source_ref text NOT NULL,
    album_id integer,
    album_entity_uid uuid,
    artist_name text DEFAULT ''::text NOT NULL,
    album_name text DEFAULT ''::text NOT NULL,
    track_entity_uids uuid[] DEFAULT '{}'::uuid[],
    metadata_json jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    imported_at timestamp with time zone NOT NULL,
    withdrawn_at timestamp with time zone
);


--
-- Name: library_contributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.library_contributions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: library_contributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.library_contributions_id_seq OWNED BY public.library_contributions.id;


--
-- Name: library_field_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_field_locks (
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    field_name text NOT NULL,
    locked_by_user_id integer,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    source text DEFAULT 'manual_edit'::text NOT NULL
);


--
-- Name: library_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_tracks (
    id integer NOT NULL,
    storage_id uuid,
    entity_uid uuid,
    album_id integer,
    artist text NOT NULL,
    album text NOT NULL,
    filename text NOT NULL,
    title text,
    track_number integer,
    disc_number integer DEFAULT 1,
    format text,
    bitrate integer,
    sample_rate integer,
    bit_depth integer,
    duration double precision,
    size bigint,
    year text,
    genre text,
    albumartist text,
    musicbrainz_albumid text,
    musicbrainz_trackid text,
    audio_fingerprint text,
    audio_fingerprint_source text,
    audio_fingerprint_computed_at timestamp with time zone,
    path text NOT NULL,
    updated_at timestamp with time zone,
    bpm double precision,
    audio_key text,
    audio_scale text,
    energy double precision,
    mood_json jsonb,
    slug text,
    danceability double precision,
    valence double precision,
    acousticness double precision,
    instrumentalness double precision,
    loudness double precision,
    dynamic_range double precision,
    spectral_complexity double precision,
    analysis_state text DEFAULT 'pending'::text,
    bliss_state text DEFAULT 'pending'::text,
    analysis_completed_at timestamp with time zone,
    bliss_computed_at timestamp with time zone,
    bliss_vector double precision[],
    lastfm_listeners integer,
    lastfm_playcount bigint,
    popularity integer,
    rating integer DEFAULT 0,
    search_vector tsvector,
    lastfm_top_rank integer,
    spotify_track_popularity integer,
    spotify_top_rank integer,
    popularity_score double precision,
    popularity_confidence double precision,
    bliss_embedding public.vector(20)
);


--
-- Name: library_tracks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.library_tracks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: library_tracks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.library_tracks_id_seq OWNED BY public.library_tracks.id;


--
-- Name: mb_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mb_cache (
    key text NOT NULL,
    value_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: metric_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_rollups (
    id integer NOT NULL,
    name text NOT NULL,
    tags_json jsonb DEFAULT '{}'::jsonb,
    period text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    sum_value double precision DEFAULT 0,
    min_value double precision,
    max_value double precision,
    avg_value double precision,
    p95_value double precision
);


--
-- Name: metric_rollups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metric_rollups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metric_rollups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metric_rollups_id_seq OWNED BY public.metric_rollups.id;


--
-- Name: music_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.music_paths (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    origin_type text NOT NULL,
    origin_value text NOT NULL,
    origin_label text,
    dest_type text NOT NULL,
    dest_value text NOT NULL,
    dest_label text,
    waypoints jsonb DEFAULT '[]'::jsonb,
    step_count integer DEFAULT 20,
    tracks jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: music_paths_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.music_paths_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: music_paths_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.music_paths_id_seq OWNED BY public.music_paths.id;


--
-- Name: new_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.new_releases (
    id integer NOT NULL,
    artist_name text NOT NULL,
    album_title text NOT NULL,
    tidal_id text,
    tidal_url text,
    cover_url text,
    year text,
    tracks integer,
    quality text,
    status text DEFAULT 'detected'::text NOT NULL,
    detected_at timestamp with time zone NOT NULL,
    downloaded_at timestamp with time zone,
    release_date date,
    release_type text DEFAULT 'Album'::text,
    mb_release_group_id text,
    source_name text,
    source_url text,
    cover_source text,
    tracklist_json jsonb DEFAULT '[]'::jsonb,
    preview_tracks_json jsonb DEFAULT '[]'::jsonb
);


--
-- Name: new_releases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.new_releases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: new_releases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.new_releases_id_seq OWNED BY public.new_releases.id;


--
-- Name: ops_runtime_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_runtime_state (
    key text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: play_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.play_history (
    id integer NOT NULL,
    user_id integer NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_path text NOT NULL,
    title text,
    artist text,
    album text,
    played_at timestamp with time zone NOT NULL
);


--
-- Name: play_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.play_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: play_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.play_history_id_seq OWNED BY public.play_history.id;


--
-- Name: playlist_generation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_generation_log (
    id integer NOT NULL,
    playlist_id integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    rule_snapshot_json jsonb,
    track_count integer,
    duration_sec integer,
    error text,
    triggered_by text DEFAULT 'manual'::text
);


--
-- Name: playlist_generation_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlist_generation_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlist_generation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlist_generation_log_id_seq OWNED BY public.playlist_generation_log.id;


--
-- Name: playlist_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_invites (
    token text NOT NULL,
    playlist_id integer NOT NULL,
    created_by integer,
    expires_at timestamp with time zone,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: playlist_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_members (
    playlist_id integer NOT NULL,
    user_id integer NOT NULL,
    role text DEFAULT 'collab'::text NOT NULL,
    invited_by integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: playlist_track_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_track_exclusions (
    id bigint NOT NULL,
    playlist_id integer NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_storage_id uuid,
    track_path text,
    reason text DEFAULT 'removed'::text NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: playlist_track_exclusions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlist_track_exclusions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlist_track_exclusions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlist_track_exclusions_id_seq OWNED BY public.playlist_track_exclusions.id;


--
-- Name: playlist_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_tracks (
    id integer NOT NULL,
    playlist_id integer NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_storage_id uuid,
    track_path text NOT NULL,
    title text,
    artist text,
    album text,
    duration double precision DEFAULT 0,
    "position" integer NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    added_at timestamp with time zone NOT NULL
);


--
-- Name: playlist_tracks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlist_tracks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlist_tracks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlist_tracks_id_seq OWNED BY public.playlist_tracks.id;


--
-- Name: playlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlists (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    cover_data_url text,
    cover_path text,
    user_id integer,
    is_smart boolean DEFAULT false,
    smart_rules_json jsonb,
    scope text DEFAULT 'user'::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    is_collaborative boolean DEFAULT false NOT NULL,
    generation_mode text DEFAULT 'static'::text NOT NULL,
    is_curated boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    managed_by_user_id integer,
    curation_key text,
    featured_rank integer,
    category text,
    track_count integer DEFAULT 0,
    total_duration double precision DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_generated_at timestamp with time zone,
    generation_status text DEFAULT 'idle'::text NOT NULL,
    generation_error text,
    auto_refresh_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: playlists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlists_id_seq OWNED BY public.playlists.id;


--
-- Name: radio_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.radio_feedback (
    id integer NOT NULL,
    user_id integer NOT NULL,
    track_id integer NOT NULL,
    action text NOT NULL,
    bliss_vector double precision[],
    session_seed text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: radio_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.radio_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: radio_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.radio_feedback_id_seq OWNED BY public.radio_feedback.id;


--
-- Name: scan_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_results (
    id integer NOT NULL,
    task_id text,
    issues_json jsonb NOT NULL,
    scanned_at timestamp with time zone NOT NULL
);


--
-- Name: scan_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scan_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scan_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scan_results_id_seq OWNED BY public.scan_results.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    last_seen_ip text,
    user_agent text,
    app_id text,
    device_label text,
    device_fingerprint text
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text
);


--
-- Name: shows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shows (
    id integer NOT NULL,
    external_id text,
    artist_name text NOT NULL,
    date date NOT NULL,
    local_time text,
    venue text,
    address_line1 text,
    city text,
    region text,
    postal_code text,
    country text,
    country_code text,
    latitude double precision,
    longitude double precision,
    url text,
    image_url text,
    lineup text[],
    price_range text,
    status text DEFAULT 'onsale'::text,
    source text DEFAULT 'ticketmaster'::text,
    lastfm_event_id text,
    lastfm_url text,
    lastfm_attendance integer,
    tickets_url text,
    scrape_city text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: shows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shows_id_seq OWNED BY public.shows.id;


--
-- Name: stream_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_variants (
    id text NOT NULL,
    cache_key text NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    source_path text NOT NULL,
    source_mtime_ns bigint NOT NULL,
    source_size bigint NOT NULL,
    source_format text,
    source_bitrate integer,
    source_sample_rate integer,
    source_bit_depth integer,
    preset text NOT NULL,
    delivery_format text NOT NULL,
    delivery_codec text NOT NULL,
    delivery_bitrate integer NOT NULL,
    delivery_sample_rate integer,
    status text DEFAULT 'pending'::text NOT NULL,
    relative_path text,
    bytes bigint,
    error text,
    task_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: task_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_events (
    id integer NOT NULL,
    task_id text NOT NULL,
    event_type text NOT NULL,
    data_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: task_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_events_id_seq OWNED BY public.task_events.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    progress text DEFAULT ''::text,
    dedup_key text,
    params_json jsonb DEFAULT '{}'::jsonb,
    result_json jsonb,
    error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    priority integer DEFAULT 2,
    pool text DEFAULT 'default'::text,
    parent_task_id text,
    max_duration_sec integer DEFAULT 1800,
    heartbeat_at timestamp with time zone,
    worker_id text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 0,
    started_at timestamp with time zone
);


--
-- Name: tidal_downloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tidal_downloads (
    id integer NOT NULL,
    tidal_url text NOT NULL,
    tidal_id text NOT NULL,
    content_type text NOT NULL,
    title text NOT NULL,
    artist text,
    cover_url text,
    quality text DEFAULT 'max'::text,
    status text DEFAULT 'wishlist'::text,
    priority integer DEFAULT 0,
    source text,
    task_id text,
    error text,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: tidal_downloads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tidal_downloads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tidal_downloads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tidal_downloads_id_seq OWNED BY public.tidal_downloads.id;


--
-- Name: tidal_monitored_artists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tidal_monitored_artists (
    artist_name text NOT NULL,
    tidal_id text,
    last_checked timestamp with time zone,
    last_release_id text,
    enabled boolean DEFAULT true
);


--
-- Name: track_analysis_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_analysis_features (
    track_id integer NOT NULL,
    bpm double precision,
    audio_key text,
    audio_scale text,
    energy double precision,
    mood_json jsonb,
    danceability double precision,
    valence double precision,
    acousticness double precision,
    instrumentalness double precision,
    loudness double precision,
    dynamic_range double precision,
    spectral_complexity double precision,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: track_bliss_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_bliss_embeddings (
    track_id integer NOT NULL,
    bliss_vector double precision[],
    bliss_embedding public.vector(20),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: track_lyrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_lyrics (
    id integer NOT NULL,
    provider text DEFAULT 'lrclib'::text NOT NULL,
    artist_key text NOT NULL,
    title_key text NOT NULL,
    artist text NOT NULL,
    title text NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    synced_lyrics text,
    plain_lyrics text,
    found boolean DEFAULT true NOT NULL,
    source_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: track_lyrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.track_lyrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: track_lyrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.track_lyrics_id_seq OWNED BY public.track_lyrics.id;


--
-- Name: track_popularity_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_popularity_features (
    track_id integer NOT NULL,
    lastfm_listeners integer,
    lastfm_playcount bigint,
    popularity integer,
    popularity_score double precision,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: track_processing_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_processing_state (
    track_id integer NOT NULL,
    pipeline text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    claimed_by text,
    claimed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: ui_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ui_snapshots (
    scope text NOT NULL,
    subject_key text DEFAULT 'global'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    built_at timestamp with time zone DEFAULT now() NOT NULL,
    source_seq bigint,
    generation_ms integer DEFAULT 0 NOT NULL,
    stale_after timestamp with time zone
);


--
-- Name: user_active_playback_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_active_playback_sessions (
    user_id integer NOT NULL,
    playback_session_id uuid NOT NULL,
    active_device_id text,
    status text NOT NULL,
    command_seq bigint DEFAULT 0 NOT NULL,
    state_revision text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: user_affinity_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_affinity_cache (
    user_a_id integer NOT NULL,
    user_b_id integer NOT NULL,
    affinity_score integer DEFAULT 0 NOT NULL,
    affinity_band text DEFAULT 'low'::text NOT NULL,
    reasons_json jsonb DEFAULT '[]'::jsonb,
    computed_at timestamp with time zone NOT NULL,
    CONSTRAINT user_affinity_cache_check CHECK ((user_a_id < user_b_id))
);


--
-- Name: user_album_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_album_stats (
    user_id integer NOT NULL,
    stat_window text NOT NULL,
    entity_key text NOT NULL,
    artist text,
    album text,
    play_count integer DEFAULT 0 NOT NULL,
    complete_play_count integer DEFAULT 0 NOT NULL,
    minutes_listened double precision DEFAULT 0 NOT NULL,
    first_played_at timestamp with time zone,
    last_played_at timestamp with time zone
);


--
-- Name: user_artist_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_artist_stats (
    user_id integer NOT NULL,
    stat_window text NOT NULL,
    artist_name text NOT NULL,
    play_count integer DEFAULT 0 NOT NULL,
    complete_play_count integer DEFAULT 0 NOT NULL,
    minutes_listened double precision DEFAULT 0 NOT NULL,
    first_played_at timestamp with time zone,
    last_played_at timestamp with time zone
);


--
-- Name: user_bandcamp_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bandcamp_items (
    id integer NOT NULL,
    user_id integer NOT NULL,
    connection_id integer NOT NULL,
    bandcamp_item_id integer NOT NULL,
    relation_type text NOT NULL,
    owned boolean DEFAULT false NOT NULL,
    downloadable boolean DEFAULT false NOT NULL,
    purchase_date timestamp with time zone,
    added_at timestamp with time zone,
    last_seen_at timestamp with time zone NOT NULL,
    removed_at timestamp with time zone,
    raw_json jsonb DEFAULT '{}'::jsonb
);


--
-- Name: user_bandcamp_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_bandcamp_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_bandcamp_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_bandcamp_items_id_seq OWNED BY public.user_bandcamp_items.id;


--
-- Name: user_daily_listening; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_daily_listening (
    user_id integer NOT NULL,
    day date NOT NULL,
    play_count integer DEFAULT 0 NOT NULL,
    complete_play_count integer DEFAULT 0 NOT NULL,
    skip_count integer DEFAULT 0 NOT NULL,
    minutes_listened double precision DEFAULT 0 NOT NULL,
    unique_tracks integer DEFAULT 0 NOT NULL,
    unique_artists integer DEFAULT 0 NOT NULL,
    unique_albums integer DEFAULT 0 NOT NULL
);


--
-- Name: user_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_devices (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    device_id text NOT NULL,
    device_label text,
    device_type text,
    app_platform text,
    app_version text,
    capabilities_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_session_id text,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: user_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_devices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_devices_id_seq OWNED BY public.user_devices.id;


--
-- Name: user_external_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_external_identities (
    id integer NOT NULL,
    user_id integer NOT NULL,
    provider text NOT NULL,
    external_user_id text,
    external_username text,
    status text DEFAULT 'unlinked'::text NOT NULL,
    last_error text,
    last_task_id text,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: user_external_identities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_external_identities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_external_identities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_external_identities_id_seq OWNED BY public.user_external_identities.id;


--
-- Name: user_followed_playlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_followed_playlists (
    user_id integer NOT NULL,
    playlist_id integer NOT NULL,
    followed_at timestamp with time zone NOT NULL
);


--
-- Name: user_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_follows (
    user_id integer NOT NULL,
    artist_name text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_genre_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_genre_stats (
    user_id integer NOT NULL,
    stat_window text NOT NULL,
    genre_name text NOT NULL,
    play_count integer DEFAULT 0 NOT NULL,
    complete_play_count integer DEFAULT 0 NOT NULL,
    minutes_listened double precision DEFAULT 0 NOT NULL,
    first_played_at timestamp with time zone,
    last_played_at timestamp with time zone
);


--
-- Name: user_liked_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_liked_tracks (
    user_id integer NOT NULL,
    track_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_play_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_play_events (
    id integer NOT NULL,
    user_id integer NOT NULL,
    client_event_id text,
    track_id integer,
    track_entity_uid uuid,
    track_path text,
    title text,
    artist text,
    album text,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    played_seconds double precision DEFAULT 0 NOT NULL,
    track_duration_seconds double precision,
    completion_ratio double precision,
    was_skipped boolean DEFAULT false NOT NULL,
    was_completed boolean DEFAULT false NOT NULL,
    play_source_type text,
    play_source_id text,
    play_source_name text,
    context_artist text,
    context_album text,
    context_playlist_id integer,
    device_type text,
    app_platform text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_play_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_play_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_play_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_play_events_id_seq OWNED BY public.user_play_events.id;


--
-- Name: user_playback_device_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_playback_device_states (
    user_id integer NOT NULL,
    device_id text NOT NULL,
    playback_session_id uuid,
    status text NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_path text,
    title text,
    artist text,
    album text,
    album_cover text,
    position_ms integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    current_index integer DEFAULT 0 NOT NULL,
    queue_revision text,
    queue_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    play_source_json jsonb,
    repeat_mode text DEFAULT 'off'::text NOT NULL,
    shuffle boolean DEFAULT false NOT NULL,
    unshuffled_queue_json jsonb,
    playback_rate double precision DEFAULT 1 NOT NULL,
    app_platform text,
    device_type text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: user_recommendation_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_recommendation_exposures (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    surface text NOT NULL,
    entity_type text NOT NULL,
    entity_key text NOT NULL,
    shown_on date NOT NULL,
    shown_count integer DEFAULT 1 NOT NULL,
    acted_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_recommendation_exposures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_recommendation_exposures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_recommendation_exposures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_recommendation_exposures_id_seq OWNED BY public.user_recommendation_exposures.id;


--
-- Name: user_recommendation_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_recommendation_feedback (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    surface text NOT NULL,
    entity_type text NOT NULL,
    entity_key text NOT NULL,
    action text NOT NULL,
    strength double precision DEFAULT 1.0 NOT NULL,
    reason text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_recommendation_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_recommendation_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_recommendation_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_recommendation_feedback_id_seq OWNED BY public.user_recommendation_feedback.id;


--
-- Name: user_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_relationships (
    follower_user_id integer NOT NULL,
    followed_user_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT user_relationships_check CHECK ((follower_user_id <> followed_user_id))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id integer NOT NULL,
    role text NOT NULL,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_saved_albums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_albums (
    user_id integer NOT NULL,
    album_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_show_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_show_attendance (
    id integer NOT NULL,
    user_id integer NOT NULL,
    show_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_show_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_show_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_show_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_show_attendance_id_seq OWNED BY public.user_show_attendance.id;


--
-- Name: user_show_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_show_reminders (
    id integer NOT NULL,
    user_id integer NOT NULL,
    show_id integer NOT NULL,
    reminder_type text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    triggered_at timestamp with time zone
);


--
-- Name: user_show_reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_show_reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_show_reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_show_reminders_id_seq OWNED BY public.user_show_reminders.id;


--
-- Name: user_track_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_track_stats (
    user_id integer NOT NULL,
    stat_window text NOT NULL,
    entity_key text NOT NULL,
    track_id integer,
    track_entity_uid uuid,
    track_path text,
    title text,
    artist text,
    album text,
    play_count integer DEFAULT 0 NOT NULL,
    complete_play_count integer DEFAULT 0 NOT NULL,
    minutes_listened double precision DEFAULT 0 NOT NULL,
    first_played_at timestamp with time zone,
    last_played_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    username text,
    name text,
    bio text,
    password_hash text,
    avatar text,
    role text DEFAULT 'user'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    suspended_at timestamp with time zone,
    suspended_by integer,
    deleted_at timestamp with time zone,
    deleted_by integer,
    google_id text,
    created_at timestamp with time zone NOT NULL,
    last_login timestamp with time zone,
    subsonic_token text,
    city text,
    country text,
    country_code text,
    latitude double precision,
    longitude double precision,
    show_location_mode text DEFAULT 'fixed'::text,
    show_radius_km integer DEFAULT 60,
    crate_connect_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: worker_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_logs (
    id bigint NOT NULL,
    worker_id text NOT NULL,
    task_id text,
    level text DEFAULT 'info'::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    message text NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: worker_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.worker_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: worker_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.worker_logs_id_seq OWNED BY public.worker_logs.id;


--
-- Name: artist_similarities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_similarities ALTER COLUMN id SET DEFAULT nextval('public.artist_similarities_id_seq'::regclass);


--
-- Name: artist_suggestions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestions ALTER COLUMN id SET DEFAULT nextval('public.artist_suggestions_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: bandcamp_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_connections ALTER COLUMN id SET DEFAULT nextval('public.bandcamp_connections_id_seq'::regclass);


--
-- Name: bandcamp_imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_imports ALTER COLUMN id SET DEFAULT nextval('public.bandcamp_imports_id_seq'::regclass);


--
-- Name: bandcamp_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_items ALTER COLUMN id SET DEFAULT nextval('public.bandcamp_items_id_seq'::regclass);


--
-- Name: bandcamp_library_matches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_library_matches ALTER COLUMN id SET DEFAULT nextval('public.bandcamp_library_matches_id_seq'::regclass);


--
-- Name: bandcamp_radar_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_radar_items ALTER COLUMN id SET DEFAULT nextval('public.bandcamp_radar_items_id_seq'::regclass);


--
-- Name: connect_command_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_command_outbox ALTER COLUMN id SET DEFAULT nextval('public.connect_command_outbox_id_seq'::regclass);


--
-- Name: entity_identity_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_identity_keys ALTER COLUMN id SET DEFAULT nextval('public.entity_identity_keys_id_seq'::regclass);


--
-- Name: equalizer_presets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equalizer_presets ALTER COLUMN id SET DEFAULT nextval('public.equalizer_presets_id_seq'::regclass);


--
-- Name: favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites ALTER COLUMN id SET DEFAULT nextval('public.favorites_id_seq'::regclass);


--
-- Name: genre_taxonomy_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_nodes ALTER COLUMN id SET DEFAULT nextval('public.genre_taxonomy_nodes_id_seq'::regclass);


--
-- Name: genres id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres ALTER COLUMN id SET DEFAULT nextval('public.genres_id_seq'::regclass);


--
-- Name: health_issues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_issues ALTER COLUMN id SET DEFAULT nextval('public.health_issues_id_seq'::regclass);


--
-- Name: import_queue_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_queue_items ALTER COLUMN id SET DEFAULT nextval('public.import_queue_items_id_seq'::regclass);


--
-- Name: jam_room_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_events ALTER COLUMN id SET DEFAULT nextval('public.jam_room_events_id_seq'::regclass);


--
-- Name: library_albums id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_albums ALTER COLUMN id SET DEFAULT nextval('public.library_albums_id_seq'::regclass);


--
-- Name: library_contributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_contributions ALTER COLUMN id SET DEFAULT nextval('public.library_contributions_id_seq'::regclass);


--
-- Name: library_tracks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_tracks ALTER COLUMN id SET DEFAULT nextval('public.library_tracks_id_seq'::regclass);


--
-- Name: metric_rollups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups ALTER COLUMN id SET DEFAULT nextval('public.metric_rollups_id_seq'::regclass);


--
-- Name: music_paths id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_paths ALTER COLUMN id SET DEFAULT nextval('public.music_paths_id_seq'::regclass);


--
-- Name: new_releases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_releases ALTER COLUMN id SET DEFAULT nextval('public.new_releases_id_seq'::regclass);


--
-- Name: play_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_history ALTER COLUMN id SET DEFAULT nextval('public.play_history_id_seq'::regclass);


--
-- Name: playlist_generation_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_generation_log ALTER COLUMN id SET DEFAULT nextval('public.playlist_generation_log_id_seq'::regclass);


--
-- Name: playlist_track_exclusions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_track_exclusions ALTER COLUMN id SET DEFAULT nextval('public.playlist_track_exclusions_id_seq'::regclass);


--
-- Name: playlist_tracks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks ALTER COLUMN id SET DEFAULT nextval('public.playlist_tracks_id_seq'::regclass);


--
-- Name: playlists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists ALTER COLUMN id SET DEFAULT nextval('public.playlists_id_seq'::regclass);


--
-- Name: radio_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_feedback ALTER COLUMN id SET DEFAULT nextval('public.radio_feedback_id_seq'::regclass);


--
-- Name: scan_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_results ALTER COLUMN id SET DEFAULT nextval('public.scan_results_id_seq'::regclass);


--
-- Name: shows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shows ALTER COLUMN id SET DEFAULT nextval('public.shows_id_seq'::regclass);


--
-- Name: task_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events ALTER COLUMN id SET DEFAULT nextval('public.task_events_id_seq'::regclass);


--
-- Name: tidal_downloads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tidal_downloads ALTER COLUMN id SET DEFAULT nextval('public.tidal_downloads_id_seq'::regclass);


--
-- Name: track_lyrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_lyrics ALTER COLUMN id SET DEFAULT nextval('public.track_lyrics_id_seq'::regclass);


--
-- Name: user_bandcamp_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items ALTER COLUMN id SET DEFAULT nextval('public.user_bandcamp_items_id_seq'::regclass);


--
-- Name: user_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices ALTER COLUMN id SET DEFAULT nextval('public.user_devices_id_seq'::regclass);


--
-- Name: user_external_identities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_external_identities ALTER COLUMN id SET DEFAULT nextval('public.user_external_identities_id_seq'::regclass);


--
-- Name: user_play_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_play_events ALTER COLUMN id SET DEFAULT nextval('public.user_play_events_id_seq'::regclass);


--
-- Name: user_recommendation_exposures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_exposures ALTER COLUMN id SET DEFAULT nextval('public.user_recommendation_exposures_id_seq'::regclass);


--
-- Name: user_recommendation_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_feedback ALTER COLUMN id SET DEFAULT nextval('public.user_recommendation_feedback_id_seq'::regclass);


--
-- Name: user_show_attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_attendance ALTER COLUMN id SET DEFAULT nextval('public.user_show_attendance_id_seq'::regclass);


--
-- Name: user_show_reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_reminders ALTER COLUMN id SET DEFAULT nextval('public.user_show_reminders_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: worker_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_logs ALTER COLUMN id SET DEFAULT nextval('public.worker_logs_id_seq'::regclass);


--
-- Name: album_genres album_genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_genres
    ADD CONSTRAINT album_genres_pkey PRIMARY KEY (album_id, genre_id);


--
-- Name: album_portable_metadata album_portable_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_portable_metadata
    ADD CONSTRAINT album_portable_metadata_pkey PRIMARY KEY (album_id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: artist_bliss_centroids artist_bliss_centroids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_bliss_centroids
    ADD CONSTRAINT artist_bliss_centroids_pkey PRIMARY KEY (artist_id);


--
-- Name: artist_genres artist_genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_genres
    ADD CONSTRAINT artist_genres_pkey PRIMARY KEY (artist_name, genre_id);


--
-- Name: artist_similarities artist_similarities_artist_name_similar_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_similarities
    ADD CONSTRAINT artist_similarities_artist_name_similar_name_key UNIQUE (artist_name, similar_name);


--
-- Name: artist_similarities artist_similarities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_similarities
    ADD CONSTRAINT artist_similarities_pkey PRIMARY KEY (id);


--
-- Name: artist_suggestion_supporters artist_suggestion_supporters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestion_supporters
    ADD CONSTRAINT artist_suggestion_supporters_pkey PRIMARY KEY (suggestion_id, user_id);


--
-- Name: artist_suggestions artist_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestions
    ADD CONSTRAINT artist_suggestions_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_invites auth_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_invites
    ADD CONSTRAINT auth_invites_pkey PRIMARY KEY (token);


--
-- Name: bandcamp_connections bandcamp_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_connections
    ADD CONSTRAINT bandcamp_connections_pkey PRIMARY KEY (id);


--
-- Name: bandcamp_connections bandcamp_connections_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_connections
    ADD CONSTRAINT bandcamp_connections_user_id_key UNIQUE (user_id);


--
-- Name: bandcamp_imports bandcamp_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_imports
    ADD CONSTRAINT bandcamp_imports_pkey PRIMARY KEY (id);


--
-- Name: bandcamp_items bandcamp_items_item_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_items
    ADD CONSTRAINT bandcamp_items_item_url_key UNIQUE (item_url);


--
-- Name: bandcamp_items bandcamp_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_items
    ADD CONSTRAINT bandcamp_items_pkey PRIMARY KEY (id);


--
-- Name: bandcamp_library_matches bandcamp_library_matches_bandcamp_item_id_entity_type_entit_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_library_matches
    ADD CONSTRAINT bandcamp_library_matches_bandcamp_item_id_entity_type_entit_key UNIQUE (bandcamp_item_id, entity_type, entity_uid);


--
-- Name: bandcamp_library_matches bandcamp_library_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_library_matches
    ADD CONSTRAINT bandcamp_library_matches_pkey PRIMARY KEY (id);


--
-- Name: bandcamp_pairing_challenges bandcamp_pairing_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_pairing_challenges
    ADD CONSTRAINT bandcamp_pairing_challenges_pkey PRIMARY KEY (pairing_id);


--
-- Name: bandcamp_radar_items bandcamp_radar_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_radar_items
    ADD CONSTRAINT bandcamp_radar_items_pkey PRIMARY KEY (id);


--
-- Name: bandcamp_radar_items bandcamp_radar_items_user_id_bandcamp_item_id_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_radar_items
    ADD CONSTRAINT bandcamp_radar_items_user_id_bandcamp_item_id_source_key UNIQUE (user_id, bandcamp_item_id, source);


--
-- Name: cache cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache
    ADD CONSTRAINT cache_pkey PRIMARY KEY (key);


--
-- Name: cast_stream_tickets cast_stream_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cast_stream_tickets
    ADD CONSTRAINT cast_stream_tickets_pkey PRIMARY KEY (ticket_hash);


--
-- Name: cast_stream_tickets cast_stream_tickets_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cast_stream_tickets
    ADD CONSTRAINT cast_stream_tickets_ticket_id_key UNIQUE (ticket_id);


--
-- Name: connect_command_outbox connect_command_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_command_outbox
    ADD CONSTRAINT connect_command_outbox_pkey PRIMARY KEY (id);


--
-- Name: connect_command_outbox connect_command_outbox_user_id_command_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_command_outbox
    ADD CONSTRAINT connect_command_outbox_user_id_command_id_key UNIQUE (user_id, command_id);


--
-- Name: credential_secrets credential_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credential_secrets
    ADD CONSTRAINT credential_secrets_pkey PRIMARY KEY (secret_ref);


--
-- Name: dir_mtimes dir_mtimes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dir_mtimes
    ADD CONSTRAINT dir_mtimes_pkey PRIMARY KEY (path);


--
-- Name: entity_identity_keys entity_identity_keys_entity_type_entity_uid_key_type_key_va_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_identity_keys
    ADD CONSTRAINT entity_identity_keys_entity_type_entity_uid_key_type_key_va_key UNIQUE (entity_type, entity_uid, key_type, key_value);


--
-- Name: entity_identity_keys entity_identity_keys_entity_type_key_type_key_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_identity_keys
    ADD CONSTRAINT entity_identity_keys_entity_type_key_type_key_value_key UNIQUE (entity_type, key_type, key_value);


--
-- Name: entity_identity_keys entity_identity_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_identity_keys
    ADD CONSTRAINT entity_identity_keys_pkey PRIMARY KEY (id);


--
-- Name: equalizer_presets equalizer_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equalizer_presets
    ADD CONSTRAINT equalizer_presets_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_item_type_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_item_type_item_id_key UNIQUE (item_type, item_id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: genre_taxonomy_aliases genre_taxonomy_aliases_alias_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_aliases
    ADD CONSTRAINT genre_taxonomy_aliases_alias_name_key UNIQUE (alias_name);


--
-- Name: genre_taxonomy_aliases genre_taxonomy_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_aliases
    ADD CONSTRAINT genre_taxonomy_aliases_pkey PRIMARY KEY (alias_slug);


--
-- Name: genre_taxonomy_edges genre_taxonomy_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_edges
    ADD CONSTRAINT genre_taxonomy_edges_pkey PRIMARY KEY (source_genre_id, target_genre_id, relation_type);


--
-- Name: genre_taxonomy_nodes genre_taxonomy_nodes_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_nodes
    ADD CONSTRAINT genre_taxonomy_nodes_name_key UNIQUE (name);


--
-- Name: genre_taxonomy_nodes genre_taxonomy_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_nodes
    ADD CONSTRAINT genre_taxonomy_nodes_pkey PRIMARY KEY (id);


--
-- Name: genre_taxonomy_nodes genre_taxonomy_nodes_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_nodes
    ADD CONSTRAINT genre_taxonomy_nodes_slug_key UNIQUE (slug);


--
-- Name: genres genres_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres
    ADD CONSTRAINT genres_name_key UNIQUE (name);


--
-- Name: genres genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres
    ADD CONSTRAINT genres_pkey PRIMARY KEY (id);


--
-- Name: genres genres_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres
    ADD CONSTRAINT genres_slug_key UNIQUE (slug);


--
-- Name: health_issues health_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_issues
    ADD CONSTRAINT health_issues_pkey PRIMARY KEY (id);


--
-- Name: i18n_bundles i18n_bundles_app_locale_source_version_bundle_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18n_bundles
    ADD CONSTRAINT i18n_bundles_app_locale_source_version_bundle_version_key UNIQUE (app, locale, source_version, bundle_version);


--
-- Name: i18n_bundles i18n_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18n_bundles
    ADD CONSTRAINT i18n_bundles_pkey PRIMARY KEY (id);


--
-- Name: i18n_translation_requests i18n_translation_requests_app_locale_source_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18n_translation_requests
    ADD CONSTRAINT i18n_translation_requests_app_locale_source_version_key UNIQUE (app, locale, source_version);


--
-- Name: i18n_translation_requests i18n_translation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18n_translation_requests
    ADD CONSTRAINT i18n_translation_requests_pkey PRIMARY KEY (id);


--
-- Name: import_queue_items import_queue_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_queue_items
    ADD CONSTRAINT import_queue_items_pkey PRIMARY KEY (id);


--
-- Name: import_queue_items import_queue_items_source_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_queue_items
    ADD CONSTRAINT import_queue_items_source_path_key UNIQUE (source, path);


--
-- Name: jam_room_events jam_room_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_events
    ADD CONSTRAINT jam_room_events_pkey PRIMARY KEY (id);


--
-- Name: jam_room_invites jam_room_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_invites
    ADD CONSTRAINT jam_room_invites_pkey PRIMARY KEY (token);


--
-- Name: jam_room_members jam_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_members
    ADD CONSTRAINT jam_room_members_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: jam_rooms jam_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_rooms
    ADD CONSTRAINT jam_rooms_pkey PRIMARY KEY (id);


--
-- Name: library_albums library_albums_artist_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_albums
    ADD CONSTRAINT library_albums_artist_name_key UNIQUE (artist, name);


--
-- Name: library_albums library_albums_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_albums
    ADD CONSTRAINT library_albums_path_key UNIQUE (path);


--
-- Name: library_albums library_albums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_albums
    ADD CONSTRAINT library_albums_pkey PRIMARY KEY (id);


--
-- Name: library_artists library_artists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_artists
    ADD CONSTRAINT library_artists_pkey PRIMARY KEY (name);


--
-- Name: library_contributions library_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_contributions
    ADD CONSTRAINT library_contributions_pkey PRIMARY KEY (id);


--
-- Name: library_contributions library_contributions_user_id_source_source_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_contributions
    ADD CONSTRAINT library_contributions_user_id_source_source_ref_key UNIQUE (user_id, source, source_ref);


--
-- Name: library_field_locks library_field_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_field_locks
    ADD CONSTRAINT library_field_locks_pkey PRIMARY KEY (entity_type, entity_id, field_name);


--
-- Name: library_tracks library_tracks_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_tracks
    ADD CONSTRAINT library_tracks_path_key UNIQUE (path);


--
-- Name: library_tracks library_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_tracks
    ADD CONSTRAINT library_tracks_pkey PRIMARY KEY (id);


--
-- Name: mb_cache mb_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mb_cache
    ADD CONSTRAINT mb_cache_pkey PRIMARY KEY (key);


--
-- Name: metric_rollups metric_rollups_name_tags_json_period_bucket_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_name_tags_json_period_bucket_start_key UNIQUE (name, tags_json, period, bucket_start);


--
-- Name: metric_rollups metric_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_pkey PRIMARY KEY (id);


--
-- Name: music_paths music_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_paths
    ADD CONSTRAINT music_paths_pkey PRIMARY KEY (id);


--
-- Name: new_releases new_releases_artist_name_album_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_releases
    ADD CONSTRAINT new_releases_artist_name_album_title_key UNIQUE (artist_name, album_title);


--
-- Name: new_releases new_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.new_releases
    ADD CONSTRAINT new_releases_pkey PRIMARY KEY (id);


--
-- Name: ops_runtime_state ops_runtime_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_runtime_state
    ADD CONSTRAINT ops_runtime_state_pkey PRIMARY KEY (key);


--
-- Name: play_history play_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_history
    ADD CONSTRAINT play_history_pkey PRIMARY KEY (id);


--
-- Name: playlist_generation_log playlist_generation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_generation_log
    ADD CONSTRAINT playlist_generation_log_pkey PRIMARY KEY (id);


--
-- Name: playlist_invites playlist_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_invites
    ADD CONSTRAINT playlist_invites_pkey PRIMARY KEY (token);


--
-- Name: playlist_members playlist_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_members
    ADD CONSTRAINT playlist_members_pkey PRIMARY KEY (playlist_id, user_id);


--
-- Name: playlist_track_exclusions playlist_track_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_track_exclusions
    ADD CONSTRAINT playlist_track_exclusions_pkey PRIMARY KEY (id);


--
-- Name: playlist_tracks playlist_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_pkey PRIMARY KEY (id);


--
-- Name: playlists playlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_pkey PRIMARY KEY (id);


--
-- Name: radio_feedback radio_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_feedback
    ADD CONSTRAINT radio_feedback_pkey PRIMARY KEY (id);


--
-- Name: scan_results scan_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_results
    ADD CONSTRAINT scan_results_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shows shows_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_external_id_key UNIQUE (external_id);


--
-- Name: shows shows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_pkey PRIMARY KEY (id);


--
-- Name: stream_variants stream_variants_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_variants
    ADD CONSTRAINT stream_variants_cache_key_key UNIQUE (cache_key);


--
-- Name: stream_variants stream_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_variants
    ADD CONSTRAINT stream_variants_pkey PRIMARY KEY (id);


--
-- Name: task_events task_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tidal_downloads tidal_downloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tidal_downloads
    ADD CONSTRAINT tidal_downloads_pkey PRIMARY KEY (id);


--
-- Name: tidal_monitored_artists tidal_monitored_artists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tidal_monitored_artists
    ADD CONSTRAINT tidal_monitored_artists_pkey PRIMARY KEY (artist_name);


--
-- Name: track_analysis_features track_analysis_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_analysis_features
    ADD CONSTRAINT track_analysis_features_pkey PRIMARY KEY (track_id);


--
-- Name: track_bliss_embeddings track_bliss_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_bliss_embeddings
    ADD CONSTRAINT track_bliss_embeddings_pkey PRIMARY KEY (track_id);


--
-- Name: track_lyrics track_lyrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_lyrics
    ADD CONSTRAINT track_lyrics_pkey PRIMARY KEY (id);


--
-- Name: track_popularity_features track_popularity_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_popularity_features
    ADD CONSTRAINT track_popularity_features_pkey PRIMARY KEY (track_id);


--
-- Name: track_processing_state track_processing_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_processing_state
    ADD CONSTRAINT track_processing_state_pkey PRIMARY KEY (track_id, pipeline);


--
-- Name: ui_snapshots ui_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_snapshots
    ADD CONSTRAINT ui_snapshots_pkey PRIMARY KEY (scope, subject_key);


--
-- Name: radio_feedback uq_radio_feedback_user_track; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_feedback
    ADD CONSTRAINT uq_radio_feedback_user_track UNIQUE (user_id, track_id);


--
-- Name: user_active_playback_sessions user_active_playback_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_active_playback_sessions
    ADD CONSTRAINT user_active_playback_sessions_pkey PRIMARY KEY (user_id);


--
-- Name: user_affinity_cache user_affinity_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_affinity_cache
    ADD CONSTRAINT user_affinity_cache_pkey PRIMARY KEY (user_a_id, user_b_id);


--
-- Name: user_album_stats user_album_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_album_stats
    ADD CONSTRAINT user_album_stats_pkey PRIMARY KEY (user_id, stat_window, entity_key);


--
-- Name: user_artist_stats user_artist_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_artist_stats
    ADD CONSTRAINT user_artist_stats_pkey PRIMARY KEY (user_id, stat_window, artist_name);


--
-- Name: user_bandcamp_items user_bandcamp_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items
    ADD CONSTRAINT user_bandcamp_items_pkey PRIMARY KEY (id);


--
-- Name: user_bandcamp_items user_bandcamp_items_user_id_bandcamp_item_id_relation_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items
    ADD CONSTRAINT user_bandcamp_items_user_id_bandcamp_item_id_relation_type_key UNIQUE (user_id, bandcamp_item_id, relation_type);


--
-- Name: user_daily_listening user_daily_listening_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_daily_listening
    ADD CONSTRAINT user_daily_listening_pkey PRIMARY KEY (user_id, day);


--
-- Name: user_devices user_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);


--
-- Name: user_devices user_devices_user_id_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_user_id_device_id_key UNIQUE (user_id, device_id);


--
-- Name: user_external_identities user_external_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_external_identities
    ADD CONSTRAINT user_external_identities_pkey PRIMARY KEY (id);


--
-- Name: user_external_identities user_external_identities_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_external_identities
    ADD CONSTRAINT user_external_identities_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: user_followed_playlists user_followed_playlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_followed_playlists
    ADD CONSTRAINT user_followed_playlists_pkey PRIMARY KEY (user_id, playlist_id);


--
-- Name: user_follows user_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_pkey PRIMARY KEY (user_id, artist_name);


--
-- Name: user_genre_stats user_genre_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_genre_stats
    ADD CONSTRAINT user_genre_stats_pkey PRIMARY KEY (user_id, stat_window, genre_name);


--
-- Name: user_liked_tracks user_liked_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_liked_tracks
    ADD CONSTRAINT user_liked_tracks_pkey PRIMARY KEY (user_id, track_id);


--
-- Name: user_play_events user_play_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_play_events
    ADD CONSTRAINT user_play_events_pkey PRIMARY KEY (id);


--
-- Name: user_playback_device_states user_playback_device_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_playback_device_states
    ADD CONSTRAINT user_playback_device_states_pkey PRIMARY KEY (user_id, device_id);


--
-- Name: user_recommendation_exposures user_recommendation_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_exposures
    ADD CONSTRAINT user_recommendation_exposures_pkey PRIMARY KEY (id);


--
-- Name: user_recommendation_exposures user_recommendation_exposures_user_id_surface_entity_type_e_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_exposures
    ADD CONSTRAINT user_recommendation_exposures_user_id_surface_entity_type_e_key UNIQUE (user_id, surface, entity_type, entity_key, shown_on);


--
-- Name: user_recommendation_feedback user_recommendation_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_feedback
    ADD CONSTRAINT user_recommendation_feedback_pkey PRIMARY KEY (id);


--
-- Name: user_recommendation_feedback user_recommendation_feedback_user_id_surface_entity_type_en_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_feedback
    ADD CONSTRAINT user_recommendation_feedback_user_id_surface_entity_type_en_key UNIQUE (user_id, surface, entity_type, entity_key, action);


--
-- Name: user_relationships user_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_relationships
    ADD CONSTRAINT user_relationships_pkey PRIMARY KEY (follower_user_id, followed_user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);


--
-- Name: user_saved_albums user_saved_albums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_albums
    ADD CONSTRAINT user_saved_albums_pkey PRIMARY KEY (user_id, album_id);


--
-- Name: user_show_attendance user_show_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_attendance
    ADD CONSTRAINT user_show_attendance_pkey PRIMARY KEY (id);


--
-- Name: user_show_attendance user_show_attendance_user_id_show_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_attendance
    ADD CONSTRAINT user_show_attendance_user_id_show_id_key UNIQUE (user_id, show_id);


--
-- Name: user_show_reminders user_show_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_reminders
    ADD CONSTRAINT user_show_reminders_pkey PRIMARY KEY (id);


--
-- Name: user_show_reminders user_show_reminders_user_id_show_id_reminder_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_reminders
    ADD CONSTRAINT user_show_reminders_user_id_show_id_reminder_type_key UNIQUE (user_id, show_id, reminder_type);


--
-- Name: user_track_stats user_track_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_track_stats
    ADD CONSTRAINT user_track_stats_pkey PRIMARY KEY (user_id, stat_window, entity_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: worker_logs worker_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_logs
    ADD CONSTRAINT worker_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_album_genres_album_weight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_album_genres_album_weight ON public.album_genres USING btree (album_id, weight DESC);


--
-- Name: idx_album_genres_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_album_genres_genre ON public.album_genres USING btree (genre_id);


--
-- Name: idx_album_portable_metadata_export; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_album_portable_metadata_export ON public.album_portable_metadata USING btree (exported_at DESC);


--
-- Name: idx_album_portable_metadata_sidecar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_album_portable_metadata_sidecar ON public.album_portable_metadata USING btree (sidecar_written_at DESC);


--
-- Name: idx_album_portable_metadata_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_album_portable_metadata_tags ON public.album_portable_metadata USING btree (audio_tags_written_at DESC);


--
-- Name: idx_albums_artist_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_artist_trgm ON public.library_albums USING gin (artist public.gin_trgm_ops);


--
-- Name: idx_albums_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_name_trgm ON public.library_albums USING gin (name public.gin_trgm_ops);


--
-- Name: idx_albums_search_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_search_fts ON public.library_albums USING gin (search_vector);


--
-- Name: idx_artist_bliss_centroids_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_bliss_centroids_name ON public.artist_bliss_centroids USING btree (lower(artist_name));


--
-- Name: idx_artist_bliss_centroids_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_bliss_centroids_updated ON public.artist_bliss_centroids USING btree (updated_at DESC);


--
-- Name: idx_artist_genres_artist_weight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_genres_artist_weight ON public.artist_genres USING btree (artist_name, weight DESC);


--
-- Name: idx_artist_genres_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_genres_genre ON public.artist_genres USING btree (genre_id);


--
-- Name: idx_artist_suggestion_supporters_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_suggestion_supporters_user ON public.artist_suggestion_supporters USING btree (user_id, created_at DESC);


--
-- Name: idx_artist_suggestions_open_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_artist_suggestions_open_key ON public.artist_suggestions USING btree (normalized_artist_name) WHERE (status = ANY (ARRAY['new'::text, 'triaged'::text, 'searching'::text]));


--
-- Name: idx_artist_suggestions_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_suggestions_status_created ON public.artist_suggestions USING btree (status, created_at DESC);


--
-- Name: idx_artists_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_name_trgm ON public.library_artists USING gin (name public.gin_trgm_ops);


--
-- Name: idx_artists_search_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_search_fts ON public.library_artists USING gin (search_vector);


--
-- Name: idx_audit_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_timestamp ON public.audit_log USING btree ("timestamp" DESC);


--
-- Name: idx_auth_invites_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_invites_created_by ON public.auth_invites USING btree (created_by, created_at DESC);


--
-- Name: idx_bandcamp_connections_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_connections_user_status ON public.bandcamp_connections USING btree (user_id, status);


--
-- Name: idx_bandcamp_imports_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_imports_user_status ON public.bandcamp_imports USING btree (user_id, status, created_at DESC);


--
-- Name: idx_bandcamp_items_type_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_items_type_name ON public.bandcamp_items USING btree (bandcamp_item_type, lower(COALESCE(artist_name, ''::text)), lower(COALESCE(album_title, ''::text)));


--
-- Name: idx_bandcamp_library_matches_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_library_matches_entity ON public.bandcamp_library_matches USING btree (entity_type, entity_uid, status);


--
-- Name: idx_bandcamp_pairing_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_pairing_user_status ON public.bandcamp_pairing_challenges USING btree (user_id, status, expires_at);


--
-- Name: idx_bandcamp_radar_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bandcamp_radar_user_status ON public.bandcamp_radar_items USING btree (user_id, status, score DESC);


--
-- Name: idx_cast_stream_tickets_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cast_stream_tickets_expires ON public.cast_stream_tickets USING btree (expires_at);


--
-- Name: idx_cast_stream_tickets_track_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cast_stream_tickets_track_entity ON public.cast_stream_tickets USING btree (track_entity_uid) WHERE (track_entity_uid IS NOT NULL);


--
-- Name: idx_cast_stream_tickets_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cast_stream_tickets_user_created ON public.cast_stream_tickets USING btree (user_id, created_at DESC);


--
-- Name: idx_connect_command_outbox_acks; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connect_command_outbox_acks ON public.connect_command_outbox USING btree (user_id, command_id) WHERE (acked_at IS NULL);


--
-- Name: idx_connect_command_outbox_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connect_command_outbox_device ON public.connect_command_outbox USING btree (user_id, target_device_id, id);


--
-- Name: idx_connect_command_outbox_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connect_command_outbox_expires ON public.connect_command_outbox USING btree (expires_at);


--
-- Name: idx_credential_secrets_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credential_secrets_expires ON public.credential_secrets USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_credential_secrets_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credential_secrets_scope ON public.credential_secrets USING btree (scope);


--
-- Name: idx_entity_identity_keys_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_identity_keys_entity ON public.entity_identity_keys USING btree (entity_type, entity_uid);


--
-- Name: idx_equalizer_presets_instance_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_equalizer_presets_instance_target ON public.equalizer_presets USING btree (scope, target_type, target_entity_uid) WHERE (scope = 'instance'::text);


--
-- Name: idx_equalizer_presets_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equalizer_presets_target ON public.equalizer_presets USING btree (target_type, target_entity_uid);


--
-- Name: idx_equalizer_presets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equalizer_presets_user ON public.equalizer_presets USING btree (user_id, updated_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_equalizer_presets_user_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_equalizer_presets_user_target ON public.equalizer_presets USING btree (scope, target_type, target_entity_uid, user_id) WHERE (scope = 'user'::text);


--
-- Name: idx_favorites_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_user_id ON public.favorites USING btree (user_id);


--
-- Name: idx_genre_taxonomy_alias_genre_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genre_taxonomy_alias_genre_id ON public.genre_taxonomy_aliases USING btree (genre_id);


--
-- Name: idx_genre_taxonomy_edges_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genre_taxonomy_edges_source ON public.genre_taxonomy_edges USING btree (source_genre_id);


--
-- Name: idx_genre_taxonomy_edges_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genre_taxonomy_edges_target ON public.genre_taxonomy_edges USING btree (target_genre_id);


--
-- Name: idx_genre_taxonomy_nodes_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_genre_taxonomy_nodes_entity_uid ON public.genre_taxonomy_nodes USING btree (entity_uid) WHERE (entity_uid IS NOT NULL);


--
-- Name: idx_genre_taxonomy_nodes_musicbrainz_mbid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_genre_taxonomy_nodes_musicbrainz_mbid ON public.genre_taxonomy_nodes USING btree (musicbrainz_mbid) WHERE (musicbrainz_mbid IS NOT NULL);


--
-- Name: idx_genres_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_genres_entity_uid ON public.genres USING btree (entity_uid) WHERE (entity_uid IS NOT NULL);


--
-- Name: idx_health_issues_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_health_issues_dedup ON public.health_issues USING btree (check_type, md5(description)) WHERE (status = 'open'::text);


--
-- Name: idx_i18n_bundles_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_i18n_bundles_published ON public.i18n_bundles USING btree (app, locale, source_version, published_at DESC) WHERE (status = 'published'::text);


--
-- Name: idx_import_queue_items_source_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_queue_items_source_status ON public.import_queue_items USING btree (source, status, updated_at DESC);


--
-- Name: idx_import_queue_items_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_queue_items_status_updated ON public.import_queue_items USING btree (status, updated_at DESC);


--
-- Name: idx_jam_room_events_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_room_events_room ON public.jam_room_events USING btree (room_id, id DESC);


--
-- Name: idx_jam_room_invites_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_room_invites_room ON public.jam_room_invites USING btree (room_id, created_at DESC);


--
-- Name: idx_jam_room_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_room_members_user ON public.jam_room_members USING btree (user_id, joined_at DESC);


--
-- Name: idx_jam_rooms_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_rooms_host ON public.jam_rooms USING btree (host_user_id, created_at DESC);


--
-- Name: idx_jam_rooms_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_rooms_tags ON public.jam_rooms USING gin (tags);


--
-- Name: idx_jam_rooms_visibility_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jam_rooms_visibility_status ON public.jam_rooms USING btree (status, visibility, created_at DESC);


--
-- Name: idx_lib_albums_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_albums_artist ON public.library_albums USING btree (artist);


--
-- Name: idx_lib_albums_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_albums_entity_uid ON public.library_albums USING btree (entity_uid);


--
-- Name: idx_lib_albums_lower_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_albums_lower_artist ON public.library_albums USING btree (lower(artist));


--
-- Name: idx_lib_albums_lower_artist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_albums_lower_artist_id ON public.library_albums USING btree (lower(artist), id);


--
-- Name: idx_lib_albums_lower_artist_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_albums_lower_artist_lower_name ON public.library_albums USING btree (lower(artist), lower(name));


--
-- Name: idx_lib_albums_popularity_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_albums_popularity_score ON public.library_albums USING btree (popularity_score DESC NULLS LAST);


--
-- Name: idx_lib_albums_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_albums_slug ON public.library_albums USING btree (slug);


--
-- Name: idx_lib_albums_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_albums_storage_id ON public.library_albums USING btree (storage_id) WHERE (storage_id IS NOT NULL);


--
-- Name: idx_lib_artists_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_artists_entity_uid ON public.library_artists USING btree (entity_uid);


--
-- Name: idx_lib_artists_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_artists_id ON public.library_artists USING btree (id);


--
-- Name: idx_lib_artists_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_artists_lower_name ON public.library_artists USING btree (lower(name));


--
-- Name: idx_lib_artists_popularity_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_artists_popularity_score ON public.library_artists USING btree (popularity_score DESC NULLS LAST);


--
-- Name: idx_lib_artists_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_artists_slug ON public.library_artists USING btree (slug);


--
-- Name: idx_lib_artists_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_artists_storage_id ON public.library_artists USING btree (storage_id) WHERE (storage_id IS NOT NULL);


--
-- Name: idx_lib_tracks_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_album ON public.library_tracks USING btree (album_id);


--
-- Name: idx_lib_tracks_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_artist ON public.library_tracks USING btree (artist);


--
-- Name: idx_lib_tracks_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_tracks_entity_uid ON public.library_tracks USING btree (entity_uid);


--
-- Name: idx_lib_tracks_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_genre ON public.library_tracks USING btree (genre);


--
-- Name: idx_lib_tracks_lastfm_playcount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_lastfm_playcount ON public.library_tracks USING btree (lastfm_playcount DESC NULLS LAST);


--
-- Name: idx_lib_tracks_lower_artist_lower_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_lower_artist_lower_title ON public.library_tracks USING btree (lower(artist), lower(title));


--
-- Name: idx_lib_tracks_popularity_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_popularity_score ON public.library_tracks USING btree (popularity_score DESC NULLS LAST);


--
-- Name: idx_lib_tracks_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_tracks_slug ON public.library_tracks USING btree (slug);


--
-- Name: idx_lib_tracks_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lib_tracks_storage_id ON public.library_tracks USING btree (storage_id) WHERE (storage_id IS NOT NULL);


--
-- Name: idx_lib_tracks_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_tracks_year ON public.library_tracks USING btree (year);


--
-- Name: idx_library_albums_bandcamp_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_albums_bandcamp_url ON public.library_albums USING btree (bandcamp_url) WHERE (bandcamp_url IS NOT NULL);


--
-- Name: idx_library_artists_bandcamp_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_artists_bandcamp_url ON public.library_artists USING btree (bandcamp_url) WHERE (bandcamp_url IS NOT NULL);


--
-- Name: idx_library_artists_new_releases_checked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_artists_new_releases_checked_at ON public.library_artists USING btree (new_releases_checked_at);


--
-- Name: idx_library_contributions_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_contributions_album ON public.library_contributions USING btree (album_id, status);


--
-- Name: idx_library_contributions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_contributions_user ON public.library_contributions USING btree (user_id, status, imported_at DESC);


--
-- Name: idx_library_field_locks_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_field_locks_entity ON public.library_field_locks USING btree (entity_type, entity_id);


--
-- Name: idx_library_tracks_bliss_embedding_cosine_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_tracks_bliss_embedding_cosine_hnsw ON public.library_tracks USING hnsw (bliss_embedding public.vector_cosine_ops) WHERE (bliss_embedding IS NOT NULL);


--
-- Name: idx_mb_cache_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mb_cache_created ON public.mb_cache USING btree (created_at);


--
-- Name: idx_metric_rollups_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metric_rollups_query ON public.metric_rollups USING btree (name, bucket_start DESC);


--
-- Name: idx_new_releases_lower_artist_lower_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_releases_lower_artist_lower_album ON public.new_releases USING btree (lower(artist_name), lower(album_title));


--
-- Name: idx_new_releases_status_release_detected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_new_releases_status_release_detected ON public.new_releases USING btree (status, release_date DESC, detected_at DESC);


--
-- Name: idx_play_history_played_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_history_played_at_desc ON public.play_history USING btree (played_at DESC);


--
-- Name: idx_play_history_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_history_track ON public.play_history USING btree (track_id);


--
-- Name: idx_play_history_track_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_history_track_entity_uid ON public.play_history USING btree (track_entity_uid);


--
-- Name: idx_play_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_history_user ON public.play_history USING btree (user_id, played_at DESC);


--
-- Name: idx_playlist_gen_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_gen_log ON public.playlist_generation_log USING btree (playlist_id, started_at DESC);


--
-- Name: idx_playlist_invites_playlist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_invites_playlist ON public.playlist_invites USING btree (playlist_id, created_at DESC);


--
-- Name: idx_playlist_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_members_user ON public.playlist_members USING btree (user_id, created_at DESC);


--
-- Name: idx_playlist_track_exclusions_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_playlist_track_exclusions_identity ON public.playlist_track_exclusions USING btree (playlist_id, COALESCE((track_entity_uid)::text, ''::text), COALESCE((track_storage_id)::text, ''::text), COALESCE(track_path, ''::text), COALESCE((track_id)::text, ''::text));


--
-- Name: idx_playlist_tracks_playlist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_playlist ON public.playlist_tracks USING btree (playlist_id, "position");


--
-- Name: idx_playlist_tracks_source_locked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_source_locked ON public.playlist_tracks USING btree (playlist_id, source, locked);


--
-- Name: idx_playlist_tracks_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_track ON public.playlist_tracks USING btree (track_id);


--
-- Name: idx_playlist_tracks_track_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_track_entity_uid ON public.playlist_tracks USING btree (track_entity_uid) WHERE (track_entity_uid IS NOT NULL);


--
-- Name: idx_playlist_tracks_track_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_track_storage_id ON public.playlist_tracks USING btree (track_storage_id) WHERE (track_storage_id IS NOT NULL);


--
-- Name: idx_playlists_curated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_curated ON public.playlists USING btree (is_curated, category, featured_rank);


--
-- Name: idx_playlists_curation_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_playlists_curation_key ON public.playlists USING btree (curation_key) WHERE (curation_key IS NOT NULL);


--
-- Name: idx_playlists_managed_by_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_managed_by_user_id ON public.playlists USING btree (managed_by_user_id);


--
-- Name: idx_playlists_scope_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_scope_active ON public.playlists USING btree (scope, is_active, updated_at DESC);


--
-- Name: idx_playlists_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_user_id ON public.playlists USING btree (user_id);


--
-- Name: idx_radio_feedback_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_radio_feedback_user_created ON public.radio_feedback USING btree (user_id, created_at DESC);


--
-- Name: idx_scan_results_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_results_task_id ON public.scan_results USING btree (task_id);


--
-- Name: idx_sessions_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_last_seen ON public.sessions USING btree (last_seen_at DESC);


--
-- Name: idx_sessions_user_active_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_active_seen ON public.sessions USING btree (user_id, COALESCE(last_seen_at, created_at) DESC) WHERE (revoked_at IS NULL);


--
-- Name: idx_sessions_user_app_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_app_device ON public.sessions USING btree (user_id, app_id, device_fingerprint) WHERE ((revoked_at IS NULL) AND (device_fingerprint IS NOT NULL));


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_shows_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_artist ON public.shows USING btree (artist_name);


--
-- Name: idx_shows_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_city ON public.shows USING btree (city);


--
-- Name: idx_shows_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_date ON public.shows USING btree (date);


--
-- Name: idx_shows_date_lower_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_date_lower_artist ON public.shows USING btree (date, lower(artist_name));


--
-- Name: idx_shows_date_lower_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_date_lower_city ON public.shows USING btree (date, lower(city));


--
-- Name: idx_shows_date_lower_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_date_lower_country ON public.shows USING btree (date, lower(country_code));


--
-- Name: idx_shows_lastfm_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_shows_lastfm_event ON public.shows USING btree (lastfm_event_id) WHERE (lastfm_event_id IS NOT NULL);


--
-- Name: idx_shows_lower_city_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_lower_city_id ON public.shows USING btree (lower(city), id);


--
-- Name: idx_shows_scrape_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shows_scrape_city ON public.shows USING btree (scrape_city);


--
-- Name: idx_similarities_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_similarities_artist ON public.artist_similarities USING btree (artist_name);


--
-- Name: idx_similarities_lower_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_similarities_lower_artist ON public.artist_similarities USING btree (lower(artist_name));


--
-- Name: idx_similarities_lower_similar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_similarities_lower_similar ON public.artist_similarities USING btree (lower(similar_name));


--
-- Name: idx_similarities_similar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_similarities_similar ON public.artist_similarities USING btree (similar_name);


--
-- Name: idx_stream_variants_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_variants_entity ON public.stream_variants USING btree (track_entity_uid);


--
-- Name: idx_stream_variants_preset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_variants_preset ON public.stream_variants USING btree (preset, status);


--
-- Name: idx_stream_variants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_variants_status ON public.stream_variants USING btree (status, updated_at);


--
-- Name: idx_stream_variants_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stream_variants_track ON public.stream_variants USING btree (track_id);


--
-- Name: idx_task_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_events_task ON public.task_events USING btree (task_id, id);


--
-- Name: idx_tasks_active_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_active_dedup ON public.tasks USING btree (type, dedup_key, created_at) WHERE ((dedup_key IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'running'::text, 'delegated'::text, 'completing'::text])));


--
-- Name: idx_tasks_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created ON public.tasks USING btree (created_at);


--
-- Name: idx_tasks_dispatch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_dispatch ON public.tasks USING btree (pool, priority, created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_tasks_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_heartbeat ON public.tasks USING btree (heartbeat_at) WHERE (status = 'running'::text);


--
-- Name: idx_tasks_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_parent ON public.tasks USING btree (parent_task_id) WHERE (parent_task_id IS NOT NULL);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tidal_downloads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tidal_downloads_status ON public.tidal_downloads USING btree (status);


--
-- Name: idx_track_analysis_features_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_analysis_features_updated ON public.track_analysis_features USING btree (updated_at DESC);


--
-- Name: idx_track_bliss_embeddings_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_bliss_embeddings_hnsw ON public.track_bliss_embeddings USING hnsw (bliss_embedding public.vector_cosine_ops);


--
-- Name: idx_track_bliss_embeddings_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_bliss_embeddings_updated ON public.track_bliss_embeddings USING btree (updated_at DESC);


--
-- Name: idx_track_lyrics_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_lyrics_entity ON public.track_lyrics USING btree (track_entity_uid);


--
-- Name: idx_track_lyrics_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_track_lyrics_lookup ON public.track_lyrics USING btree (provider, artist_key, title_key);


--
-- Name: idx_track_lyrics_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_lyrics_track ON public.track_lyrics USING btree (track_id);


--
-- Name: idx_track_lyrics_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_lyrics_updated ON public.track_lyrics USING btree (updated_at DESC);


--
-- Name: idx_track_popularity_features_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_popularity_features_score ON public.track_popularity_features USING btree (popularity_score DESC, popularity DESC, updated_at DESC);


--
-- Name: idx_track_processing_state_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_processing_state_claim ON public.track_processing_state USING btree (pipeline, state, priority, claimed_at);


--
-- Name: idx_track_processing_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_track_processing_state_updated ON public.track_processing_state USING btree (pipeline, updated_at DESC);


--
-- Name: idx_tracks_analysis_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_analysis_pending ON public.library_tracks USING btree (updated_at DESC) WHERE (analysis_state = 'pending'::text);


--
-- Name: idx_tracks_artist_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_artist_trgm ON public.library_tracks USING gin (artist public.gin_trgm_ops);


--
-- Name: idx_tracks_bliss_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_bliss_pending ON public.library_tracks USING btree (updated_at DESC) WHERE (bliss_state = 'pending'::text);


--
-- Name: idx_tracks_bpm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_bpm ON public.library_tracks USING btree (bpm) WHERE (bpm IS NOT NULL);


--
-- Name: idx_tracks_energy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_energy ON public.library_tracks USING btree (energy) WHERE (energy IS NOT NULL);


--
-- Name: idx_tracks_search_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_search_fts ON public.library_tracks USING gin (search_vector);


--
-- Name: idx_tracks_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracks_title_trgm ON public.library_tracks USING gin (title public.gin_trgm_ops);


--
-- Name: idx_ui_snapshots_scope_built_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ui_snapshots_scope_built_at ON public.ui_snapshots USING btree (scope, built_at DESC);


--
-- Name: idx_ui_snapshots_stale_after; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ui_snapshots_stale_after ON public.ui_snapshots USING btree (stale_after);


--
-- Name: idx_user_active_playback_sessions_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_active_playback_sessions_device ON public.user_active_playback_sessions USING btree (user_id, active_device_id) WHERE (active_device_id IS NOT NULL);


--
-- Name: idx_user_active_playback_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_active_playback_sessions_expires ON public.user_active_playback_sessions USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_user_affinity_cache_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_affinity_cache_score ON public.user_affinity_cache USING btree (affinity_score DESC, computed_at DESC);


--
-- Name: idx_user_album_stats_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_album_stats_lookup ON public.user_album_stats USING btree (user_id, stat_window, play_count DESC);


--
-- Name: idx_user_artist_stats_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_artist_stats_lookup ON public.user_artist_stats USING btree (user_id, stat_window, play_count DESC);


--
-- Name: idx_user_bandcamp_items_user_relation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bandcamp_items_user_relation ON public.user_bandcamp_items USING btree (user_id, relation_type, removed_at);


--
-- Name: idx_user_daily_listening_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_daily_listening_user ON public.user_daily_listening USING btree (user_id, day DESC);


--
-- Name: idx_user_devices_user_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_devices_user_seen ON public.user_devices USING btree (user_id, last_seen_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: idx_user_external_identities_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_external_identities_provider ON public.user_external_identities USING btree (provider);


--
-- Name: idx_user_external_identities_provider_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_external_identities_provider_user_id ON public.user_external_identities USING btree (provider, external_user_id) WHERE (external_user_id IS NOT NULL);


--
-- Name: idx_user_external_identities_provider_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_external_identities_provider_username ON public.user_external_identities USING btree (provider, external_username) WHERE (external_username IS NOT NULL);


--
-- Name: idx_user_followed_playlists_playlist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_followed_playlists_playlist ON public.user_followed_playlists USING btree (playlist_id);


--
-- Name: idx_user_followed_playlists_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_followed_playlists_user ON public.user_followed_playlists USING btree (user_id, followed_at DESC);


--
-- Name: idx_user_follows_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_follows_user ON public.user_follows USING btree (user_id);


--
-- Name: idx_user_genre_stats_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_genre_stats_lookup ON public.user_genre_stats USING btree (user_id, stat_window, play_count DESC);


--
-- Name: idx_user_liked_tracks_track_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_liked_tracks_track_id ON public.user_liked_tracks USING btree (track_id);


--
-- Name: idx_user_liked_tracks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_liked_tracks_user ON public.user_liked_tracks USING btree (user_id);


--
-- Name: idx_user_liked_tracks_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_liked_tracks_user_created ON public.user_liked_tracks USING btree (user_id, created_at DESC);


--
-- Name: idx_user_play_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_source ON public.user_play_events USING btree (user_id, play_source_type, ended_at DESC);


--
-- Name: idx_user_play_events_track; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_track ON public.user_play_events USING btree (track_id);


--
-- Name: idx_user_play_events_track_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_track_entity_uid ON public.user_play_events USING btree (track_entity_uid);


--
-- Name: idx_user_play_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_user ON public.user_play_events USING btree (user_id, ended_at DESC);


--
-- Name: idx_user_play_events_user_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_user_album ON public.user_play_events USING btree (user_id, album, ended_at DESC);


--
-- Name: idx_user_play_events_user_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_play_events_user_artist ON public.user_play_events USING btree (user_id, artist, ended_at DESC);


--
-- Name: idx_user_play_events_user_client_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_play_events_user_client_event ON public.user_play_events USING btree (user_id, client_event_id) WHERE (client_event_id IS NOT NULL);


--
-- Name: idx_user_playback_states_track_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_playback_states_track_entity ON public.user_playback_device_states USING btree (track_entity_uid) WHERE (track_entity_uid IS NOT NULL);


--
-- Name: idx_user_playback_states_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_playback_states_user_updated ON public.user_playback_device_states USING btree (user_id, updated_at DESC);


--
-- Name: idx_user_recommendation_exposures_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_recommendation_exposures_expiry ON public.user_recommendation_exposures USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_user_recommendation_exposures_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_recommendation_exposures_lookup ON public.user_recommendation_exposures USING btree (user_id, surface, entity_type, entity_key, shown_on DESC);


--
-- Name: idx_user_recommendation_feedback_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_recommendation_feedback_active ON public.user_recommendation_feedback USING btree (user_id, surface, entity_type, entity_key, action, expires_at);


--
-- Name: idx_user_recommendation_feedback_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_recommendation_feedback_lookup ON public.user_recommendation_feedback USING btree (user_id, surface, entity_type, entity_key);


--
-- Name: idx_user_relationships_followed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_relationships_followed ON public.user_relationships USING btree (followed_user_id, created_at DESC);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role, user_id);


--
-- Name: idx_user_saved_albums_album_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_saved_albums_album_id ON public.user_saved_albums USING btree (album_id);


--
-- Name: idx_user_saved_albums_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_saved_albums_user ON public.user_saved_albums USING btree (user_id);


--
-- Name: idx_user_saved_albums_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_saved_albums_user_created ON public.user_saved_albums USING btree (user_id, created_at DESC);


--
-- Name: idx_user_show_attendance_show; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_show_attendance_show ON public.user_show_attendance USING btree (show_id);


--
-- Name: idx_user_show_attendance_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_show_attendance_user ON public.user_show_attendance USING btree (user_id);


--
-- Name: idx_user_show_reminders_show_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_show_reminders_show_id ON public.user_show_reminders USING btree (show_id);


--
-- Name: idx_user_show_reminders_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_show_reminders_type ON public.user_show_reminders USING btree (user_id, reminder_type);


--
-- Name: idx_user_show_reminders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_show_reminders_user ON public.user_show_reminders USING btree (user_id, show_id);


--
-- Name: idx_user_track_stats_entity_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_track_stats_entity_uid ON public.user_track_stats USING btree (track_entity_uid);


--
-- Name: idx_user_track_stats_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_track_stats_lookup ON public.user_track_stats USING btree (user_id, stat_window, play_count DESC);


--
-- Name: idx_user_track_stats_track_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_track_stats_track_id ON public.user_track_stats USING btree (track_id);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: idx_worker_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_logs_level ON public.worker_logs USING btree (level, created_at DESC);


--
-- Name: idx_worker_logs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_logs_task ON public.worker_logs USING btree (task_id, id) WHERE (task_id IS NOT NULL);


--
-- Name: idx_worker_logs_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_logs_worker ON public.worker_logs USING btree (worker_id, created_at DESC);


--
-- Name: ix_music_paths_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_music_paths_user_id ON public.music_paths USING btree (user_id);


--
-- Name: ix_radio_feedback_user_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_radio_feedback_user_action ON public.radio_feedback USING btree (user_id, action);


--
-- Name: ix_radio_feedback_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_radio_feedback_user_id ON public.radio_feedback USING btree (user_id);


--
-- Name: library_albums trg_albums_search_cascade; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_albums_search_cascade AFTER UPDATE ON public.library_albums FOR EACH ROW EXECUTE FUNCTION public.library_albums_search_cascade();


--
-- Name: library_albums trg_albums_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_albums_search_vector BEFORE INSERT OR UPDATE ON public.library_albums FOR EACH ROW EXECUTE FUNCTION public.library_albums_search_update();


--
-- Name: library_artists trg_artists_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_artists_search_vector BEFORE INSERT OR UPDATE ON public.library_artists FOR EACH ROW EXECUTE FUNCTION public.library_artists_search_update();


--
-- Name: library_tracks trg_tracks_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tracks_search_vector BEFORE INSERT OR UPDATE ON public.library_tracks FOR EACH ROW EXECUTE FUNCTION public.library_tracks_search_update();


--
-- Name: album_genres album_genres_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_genres
    ADD CONSTRAINT album_genres_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.library_albums(id) ON DELETE CASCADE;


--
-- Name: album_genres album_genres_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_genres
    ADD CONSTRAINT album_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id) ON DELETE CASCADE;


--
-- Name: album_portable_metadata album_portable_metadata_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_portable_metadata
    ADD CONSTRAINT album_portable_metadata_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.library_albums(id) ON DELETE CASCADE;


--
-- Name: artist_bliss_centroids artist_bliss_centroids_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_bliss_centroids
    ADD CONSTRAINT artist_bliss_centroids_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.library_artists(id) ON DELETE CASCADE;


--
-- Name: artist_genres artist_genres_artist_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_genres
    ADD CONSTRAINT artist_genres_artist_name_fkey FOREIGN KEY (artist_name) REFERENCES public.library_artists(name) ON DELETE CASCADE;


--
-- Name: artist_genres artist_genres_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_genres
    ADD CONSTRAINT artist_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id) ON DELETE CASCADE;


--
-- Name: artist_suggestion_supporters artist_suggestion_supporters_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestion_supporters
    ADD CONSTRAINT artist_suggestion_supporters_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.artist_suggestions(id) ON DELETE CASCADE;


--
-- Name: artist_suggestion_supporters artist_suggestion_supporters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestion_supporters
    ADD CONSTRAINT artist_suggestion_supporters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artist_suggestions artist_suggestions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestions
    ADD CONSTRAINT artist_suggestions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: artist_suggestions artist_suggestions_linked_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestions
    ADD CONSTRAINT artist_suggestions_linked_artist_id_fkey FOREIGN KEY (linked_artist_id) REFERENCES public.library_artists(id) ON DELETE SET NULL;


--
-- Name: artist_suggestions artist_suggestions_triaged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_suggestions
    ADD CONSTRAINT artist_suggestions_triaged_by_user_id_fkey FOREIGN KEY (triaged_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: auth_invites auth_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_invites
    ADD CONSTRAINT auth_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bandcamp_connections bandcamp_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_connections
    ADD CONSTRAINT bandcamp_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bandcamp_imports bandcamp_imports_bandcamp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_imports
    ADD CONSTRAINT bandcamp_imports_bandcamp_item_id_fkey FOREIGN KEY (bandcamp_item_id) REFERENCES public.bandcamp_items(id) ON DELETE CASCADE;


--
-- Name: bandcamp_imports bandcamp_imports_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_imports
    ADD CONSTRAINT bandcamp_imports_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.bandcamp_connections(id) ON DELETE SET NULL;


--
-- Name: bandcamp_imports bandcamp_imports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_imports
    ADD CONSTRAINT bandcamp_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bandcamp_library_matches bandcamp_library_matches_bandcamp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_library_matches
    ADD CONSTRAINT bandcamp_library_matches_bandcamp_item_id_fkey FOREIGN KEY (bandcamp_item_id) REFERENCES public.bandcamp_items(id) ON DELETE CASCADE;


--
-- Name: bandcamp_pairing_challenges bandcamp_pairing_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_pairing_challenges
    ADD CONSTRAINT bandcamp_pairing_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bandcamp_radar_items bandcamp_radar_items_bandcamp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_radar_items
    ADD CONSTRAINT bandcamp_radar_items_bandcamp_item_id_fkey FOREIGN KEY (bandcamp_item_id) REFERENCES public.bandcamp_items(id) ON DELETE CASCADE;


--
-- Name: bandcamp_radar_items bandcamp_radar_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandcamp_radar_items
    ADD CONSTRAINT bandcamp_radar_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cast_stream_tickets cast_stream_tickets_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cast_stream_tickets
    ADD CONSTRAINT cast_stream_tickets_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: cast_stream_tickets cast_stream_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cast_stream_tickets
    ADD CONSTRAINT cast_stream_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: connect_command_outbox connect_command_outbox_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_command_outbox
    ADD CONSTRAINT connect_command_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: connect_command_outbox connect_command_outbox_user_id_target_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_command_outbox
    ADD CONSTRAINT connect_command_outbox_user_id_target_device_id_fkey FOREIGN KEY (user_id, target_device_id) REFERENCES public.user_devices(user_id, device_id) ON DELETE CASCADE;


--
-- Name: equalizer_presets equalizer_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equalizer_presets
    ADD CONSTRAINT equalizer_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: equalizer_presets equalizer_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equalizer_presets
    ADD CONSTRAINT equalizer_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stream_variants fk_stream_variants_track; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_variants
    ADD CONSTRAINT fk_stream_variants_track FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: genre_taxonomy_aliases genre_taxonomy_aliases_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_aliases
    ADD CONSTRAINT genre_taxonomy_aliases_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genre_taxonomy_nodes(id) ON DELETE CASCADE;


--
-- Name: genre_taxonomy_edges genre_taxonomy_edges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_edges
    ADD CONSTRAINT genre_taxonomy_edges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: genre_taxonomy_edges genre_taxonomy_edges_source_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_edges
    ADD CONSTRAINT genre_taxonomy_edges_source_genre_id_fkey FOREIGN KEY (source_genre_id) REFERENCES public.genre_taxonomy_nodes(id) ON DELETE CASCADE;


--
-- Name: genre_taxonomy_edges genre_taxonomy_edges_target_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_taxonomy_edges
    ADD CONSTRAINT genre_taxonomy_edges_target_genre_id_fkey FOREIGN KEY (target_genre_id) REFERENCES public.genre_taxonomy_nodes(id) ON DELETE CASCADE;


--
-- Name: jam_room_events jam_room_events_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_events
    ADD CONSTRAINT jam_room_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.jam_rooms(id) ON DELETE CASCADE;


--
-- Name: jam_room_events jam_room_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_events
    ADD CONSTRAINT jam_room_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jam_room_invites jam_room_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_invites
    ADD CONSTRAINT jam_room_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jam_room_invites jam_room_invites_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_invites
    ADD CONSTRAINT jam_room_invites_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.jam_rooms(id) ON DELETE CASCADE;


--
-- Name: jam_room_members jam_room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_members
    ADD CONSTRAINT jam_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.jam_rooms(id) ON DELETE CASCADE;


--
-- Name: jam_room_members jam_room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_room_members
    ADD CONSTRAINT jam_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: jam_rooms jam_rooms_host_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jam_rooms
    ADD CONSTRAINT jam_rooms_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: library_albums library_albums_artist_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_albums
    ADD CONSTRAINT library_albums_artist_fkey FOREIGN KEY (artist) REFERENCES public.library_artists(name);


--
-- Name: library_contributions library_contributions_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_contributions
    ADD CONSTRAINT library_contributions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.library_albums(id) ON DELETE SET NULL;


--
-- Name: library_contributions library_contributions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_contributions
    ADD CONSTRAINT library_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: library_field_locks library_field_locks_locked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_field_locks
    ADD CONSTRAINT library_field_locks_locked_by_user_id_fkey FOREIGN KEY (locked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: library_tracks library_tracks_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_tracks
    ADD CONSTRAINT library_tracks_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.library_albums(id) ON DELETE CASCADE;


--
-- Name: music_paths music_paths_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_paths
    ADD CONSTRAINT music_paths_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: play_history play_history_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_history
    ADD CONSTRAINT play_history_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: play_history play_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_history
    ADD CONSTRAINT play_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: playlist_generation_log playlist_generation_log_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_generation_log
    ADD CONSTRAINT playlist_generation_log_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_invites playlist_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_invites
    ADD CONSTRAINT playlist_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: playlist_invites playlist_invites_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_invites
    ADD CONSTRAINT playlist_invites_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_members playlist_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_members
    ADD CONSTRAINT playlist_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: playlist_members playlist_members_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_members
    ADD CONSTRAINT playlist_members_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_members playlist_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_members
    ADD CONSTRAINT playlist_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: playlist_track_exclusions playlist_track_exclusions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_track_exclusions
    ADD CONSTRAINT playlist_track_exclusions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: playlist_track_exclusions playlist_track_exclusions_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_track_exclusions
    ADD CONSTRAINT playlist_track_exclusions_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_track_exclusions playlist_track_exclusions_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_track_exclusions
    ADD CONSTRAINT playlist_track_exclusions_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: playlist_tracks playlist_tracks_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_tracks playlist_tracks_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: playlists playlists_managed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_managed_by_user_id_fkey FOREIGN KEY (managed_by_user_id) REFERENCES public.users(id);


--
-- Name: playlists playlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: radio_feedback radio_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radio_feedback
    ADD CONSTRAINT radio_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scan_results scan_results_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_results
    ADD CONSTRAINT scan_results_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_events task_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: track_analysis_features track_analysis_features_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_analysis_features
    ADD CONSTRAINT track_analysis_features_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: track_bliss_embeddings track_bliss_embeddings_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_bliss_embeddings
    ADD CONSTRAINT track_bliss_embeddings_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: track_lyrics track_lyrics_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_lyrics
    ADD CONSTRAINT track_lyrics_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: track_popularity_features track_popularity_features_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_popularity_features
    ADD CONSTRAINT track_popularity_features_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: track_processing_state track_processing_state_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_processing_state
    ADD CONSTRAINT track_processing_state_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: user_active_playback_sessions user_active_playback_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_active_playback_sessions
    ADD CONSTRAINT user_active_playback_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_affinity_cache user_affinity_cache_user_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_affinity_cache
    ADD CONSTRAINT user_affinity_cache_user_a_id_fkey FOREIGN KEY (user_a_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_affinity_cache user_affinity_cache_user_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_affinity_cache
    ADD CONSTRAINT user_affinity_cache_user_b_id_fkey FOREIGN KEY (user_b_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_album_stats user_album_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_album_stats
    ADD CONSTRAINT user_album_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_artist_stats user_artist_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_artist_stats
    ADD CONSTRAINT user_artist_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_bandcamp_items user_bandcamp_items_bandcamp_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items
    ADD CONSTRAINT user_bandcamp_items_bandcamp_item_id_fkey FOREIGN KEY (bandcamp_item_id) REFERENCES public.bandcamp_items(id) ON DELETE CASCADE;


--
-- Name: user_bandcamp_items user_bandcamp_items_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items
    ADD CONSTRAINT user_bandcamp_items_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.bandcamp_connections(id) ON DELETE CASCADE;


--
-- Name: user_bandcamp_items user_bandcamp_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bandcamp_items
    ADD CONSTRAINT user_bandcamp_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_daily_listening user_daily_listening_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_daily_listening
    ADD CONSTRAINT user_daily_listening_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_devices user_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_external_identities user_external_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_external_identities
    ADD CONSTRAINT user_external_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_followed_playlists user_followed_playlists_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_followed_playlists
    ADD CONSTRAINT user_followed_playlists_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: user_followed_playlists user_followed_playlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_followed_playlists
    ADD CONSTRAINT user_followed_playlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_follows user_follows_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_genre_stats user_genre_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_genre_stats
    ADD CONSTRAINT user_genre_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_liked_tracks user_liked_tracks_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_liked_tracks
    ADD CONSTRAINT user_liked_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE CASCADE;


--
-- Name: user_liked_tracks user_liked_tracks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_liked_tracks
    ADD CONSTRAINT user_liked_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_play_events user_play_events_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_play_events
    ADD CONSTRAINT user_play_events_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: user_play_events user_play_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_play_events
    ADD CONSTRAINT user_play_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_playback_device_states user_playback_device_states_user_id_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_playback_device_states
    ADD CONSTRAINT user_playback_device_states_user_id_device_id_fkey FOREIGN KEY (user_id, device_id) REFERENCES public.user_devices(user_id, device_id) ON DELETE CASCADE;


--
-- Name: user_playback_device_states user_playback_device_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_playback_device_states
    ADD CONSTRAINT user_playback_device_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_recommendation_exposures user_recommendation_exposures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_exposures
    ADD CONSTRAINT user_recommendation_exposures_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_recommendation_feedback user_recommendation_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_feedback
    ADD CONSTRAINT user_recommendation_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_relationships user_relationships_followed_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_relationships
    ADD CONSTRAINT user_relationships_followed_user_id_fkey FOREIGN KEY (followed_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_relationships user_relationships_follower_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_relationships
    ADD CONSTRAINT user_relationships_follower_user_id_fkey FOREIGN KEY (follower_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_saved_albums user_saved_albums_album_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_albums
    ADD CONSTRAINT user_saved_albums_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.library_albums(id) ON DELETE CASCADE;


--
-- Name: user_saved_albums user_saved_albums_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_albums
    ADD CONSTRAINT user_saved_albums_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_show_attendance user_show_attendance_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_attendance
    ADD CONSTRAINT user_show_attendance_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: user_show_attendance user_show_attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_attendance
    ADD CONSTRAINT user_show_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_show_reminders user_show_reminders_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_reminders
    ADD CONSTRAINT user_show_reminders_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: user_show_reminders user_show_reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_show_reminders
    ADD CONSTRAINT user_show_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_track_stats user_track_stats_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_track_stats
    ADD CONSTRAINT user_track_stats_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.library_tracks(id) ON DELETE SET NULL;


--
-- Name: user_track_stats user_track_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_track_stats
    ADD CONSTRAINT user_track_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_suspended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--


