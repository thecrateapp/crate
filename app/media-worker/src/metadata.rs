//! Rich metadata tag writer for Crate identity fields, lyrics, and analysis data.

use std::fs;
use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
use serde_json::Value;

const TAG_SCHEMA_VERSION: &str = "1";

pub fn write_rich_tags(
    path: &Path,
    track_payload: &Value,
    package_payload: Option<&Value>,
    artwork_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    if !path.is_file() {
        return Err(format!("track copy does not exist: {}", path.display()));
    }

    let tagged = lofty::read_from_path(path).map_err(|err| err.to_string())?;
    let existing_tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let tag_type = preferred_tag_type(path, existing_tag.map(|tag| tag.tag_type()))
        .ok_or_else(|| "unsupported audio tag type".to_string())?;
    if !supports_rich_writes(tag_type) {
        return Err(format!(
            "tag type {tag_type:?} does not support Crate rich export tags"
        ));
    }

    let mut tag = existing_tag
        .filter(|tag| tag.tag_type() == tag_type)
        .cloned()
        .unwrap_or_else(|| Tag::new(tag_type));

    let mut written = Vec::new();
    for (key, value) in rich_tags(track_payload, package_payload) {
        insert_custom_text(&mut tag, &key, value);
        written.push(key);
    }

    if let Some(plain) = text_at(track_payload, &["lyrics", "plain"])
        .or_else(|| text_at(track_payload, &["lyrics", "plainLyrics"]))
    {
        if tag.insert_text(ItemKey::Lyrics, plain) {
            written.push("lyrics".to_string());
        }
    }

    if let Some(artwork) = artwork_path.filter(|path| path.is_file()) {
        tag.remove_picture_type(PictureType::CoverFront);
        let mime_type = image_mime(artwork)
            .ok_or_else(|| format!("unsupported artwork format: {}", artwork.display()))?;
        tag.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(mime_type),
            Some("Cover".to_string()),
            fs::read(artwork)
                .map_err(|err| format!("read artwork {}: {err}", artwork.display()))?,
        ));
        written.push("artwork".to_string());
    }

    tag.save_to_path(path, WriteOptions::default())
        .map_err(|err| err.to_string())?;
    written.sort();
    Ok(written)
}

fn preferred_tag_type(path: &Path, fallback: Option<TagType>) -> Option<TagType> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "flac" | "ogg" | "opus" => Some(TagType::VorbisComments),
        "m4a" | "mp4" | "aac" | "alac" => Some(TagType::Mp4Ilst),
        "mp3" => Some(TagType::Id3v2),
        _ => fallback,
    }
}

fn supports_rich_writes(tag_type: TagType) -> bool {
    matches!(
        tag_type,
        TagType::VorbisComments | TagType::Mp4Ilst | TagType::Id3v2 | TagType::Ape
    )
}

fn rich_tags(track_payload: &Value, package_payload: Option<&Value>) -> Vec<(String, String)> {
    let artist_uid = text_at(track_payload, &["artist_entity_uid"]).or_else(|| {
        package_payload.and_then(|payload| text_at(payload, &["artist", "entity_uid"]))
    });
    let album_uid = text_at(track_payload, &["album_entity_uid"])
        .or_else(|| package_payload.and_then(|payload| text_at(payload, &["album", "entity_uid"])));
    let track_uid = text_at(track_payload, &["entity_uid"]);

    let mut tags = vec![(
        "crate_schema_version".to_string(),
        TAG_SCHEMA_VERSION.to_string(),
    )];
    push_if_some(&mut tags, "crate_artist_uid", artist_uid);
    push_if_some(&mut tags, "crate_album_uid", album_uid);
    push_if_some(&mut tags, "crate_track_uid", track_uid);
    push_if_some(
        &mut tags,
        "crate_audio_fingerprint",
        text_at(track_payload, &["audio_fingerprint"]),
    );
    push_if_some(
        &mut tags,
        "crate_audio_fingerprint_source",
        text_at(track_payload, &["audio_fingerprint_source"]),
    );

    let plain = text_at(track_payload, &["lyrics", "plain"])
        .or_else(|| text_at(track_payload, &["lyrics", "plainLyrics"]));
    let synced = text_at(track_payload, &["lyrics", "synced"])
        .or_else(|| text_at(track_payload, &["lyrics", "syncedLyrics"]));
    push_if_some(&mut tags, "crate_plain_lyrics", plain.clone());
    push_if_some(&mut tags, "unsyncedlyrics", plain);
    push_if_some(&mut tags, "crate_synced_lyrics", synced.clone());
    push_if_some(&mut tags, "syncedlyrics", synced);

    if let Some(analysis) = object_at(track_payload, &["analysis"]) {
        if !analysis
            .as_object()
            .map(|value| value.is_empty())
            .unwrap_or(true)
        {
            push_if_some(
                &mut tags,
                "crate_analysis_json",
                serde_json::to_string(analysis).ok(),
            );
        }
    }
    if let Some(vector) = vector_at(track_payload, &["bliss", "vector"]) {
        push_if_some(&mut tags, "crate_bliss_vector", Some(vector));
    }

    tags.into_iter()
        .filter(|(_, value)| !value.trim().is_empty())
        .collect()
}

fn push_if_some(tags: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        let text = value.trim();
        if !text.is_empty() {
            tags.push((key.to_string(), text.to_string()));
        }
    }
}

fn insert_custom_text(tag: &mut Tag, key: &str, value: String) {
    let item_key = if tag.tag_type() == TagType::Mp4Ilst {
        ItemKey::Unknown(format!("----:com.crate:{key}"))
    } else {
        ItemKey::Unknown(key.to_string())
    };
    tag.insert_unchecked(TagItem::new(item_key, ItemValue::Text(value)));
}

fn text_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    match current {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn object_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.is_object().then_some(current)
}

fn vector_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.is_empty() {
        return None;
    }
    Some(
        values
            .iter()
            .filter_map(|value| match value {
                Value::Number(number) => Some(number.to_string()),
                Value::String(text) => Some(text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn image_mime(path: &Path) -> Option<MimeType> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some(MimeType::Jpeg),
        "png" => Some(MimeType::Png),
        "gif" => Some(MimeType::Gif),
        "bmp" => Some(MimeType::Bmp),
        "tif" | "tiff" => Some(MimeType::Tiff),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_from_str(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    // ── text_at ──────────────────────────────────────────────────────

    #[test]
    fn text_at_string_value() {
        let v: Value = serde_json::from_str(r#"{"foo": {"bar": "hello"}}"#).unwrap();
        assert_eq!(text_at(&v, &["foo", "bar"]), Some("hello".to_string()));
    }

    #[test]
    fn text_at_number_value() {
        let v: Value = serde_json::from_str(r#"{"foo": 42}"#).unwrap();
        assert_eq!(text_at(&v, &["foo"]), Some("42".to_string()));
    }

    #[test]
    fn text_at_bool_value() {
        let v: Value = serde_json::from_str(r#"{"foo": true}"#).unwrap();
        assert_eq!(text_at(&v, &["foo"]), Some("true".to_string()));
    }

    #[test]
    fn text_at_null_value() {
        let v: Value = serde_json::from_str(r#"{"foo": null}"#).unwrap();
        assert_eq!(text_at(&v, &["foo"]), None);
    }

    #[test]
    fn text_at_missing_key() {
        let v: Value = serde_json::from_str(r#"{"foo": "bar"}"#).unwrap();
        assert_eq!(text_at(&v, &["baz"]), None);
    }

    #[test]
    fn text_at_nested_missing() {
        let v: Value = serde_json::from_str(r#"{"foo": "bar"}"#).unwrap();
        assert_eq!(text_at(&v, &["foo", "baz"]), None);
    }

    #[test]
    fn text_at_empty_path() {
        let v: Value = serde_json::from_str(r#""hello""#).unwrap();
        assert_eq!(text_at(&v, &[]), Some("hello".to_string()));
    }

    #[test]
    fn text_at_object_value() {
        let v: Value = serde_json::from_str(r#"{"foo": {"bar": 1}}"#).unwrap();
        assert_eq!(text_at(&v, &["foo"]), None);
    }

    // ── object_at ────────────────────────────────────────────────────

    #[test]
    fn object_at_returns_object() {
        let v: Value = serde_json::from_str(r#"{"a": {"b": {"c": 1}}}"#).unwrap();
        let result = object_at(&v, &["a", "b"]);
        assert!(result.is_some());
        assert!(result.unwrap().is_object());
    }

    #[test]
    fn object_at_returns_none_for_string() {
        let v: Value = serde_json::from_str(r#"{"a": "not an object"}"#).unwrap();
        assert_eq!(object_at(&v, &["a"]), None);
    }

    #[test]
    fn object_at_missing_path() {
        let v: Value = serde_json::from_str(r#"{"a": {}}"#).unwrap();
        assert_eq!(object_at(&v, &["a", "missing"]), None);
    }

    #[test]
    fn object_at_returns_none_for_array() {
        let v: Value = serde_json::from_str(r#"{"a": [1, 2, 3]}"#).unwrap();
        assert_eq!(object_at(&v, &["a"]), None);
    }

    // ── vector_at ────────────────────────────────────────────────────

    #[test]
    fn vector_at_numbers() {
        let v: Value =
            serde_json::from_str(r#"{"bliss": {"vector": [0.1, 0.2, 0.3]}}"#).unwrap();
        assert_eq!(
            vector_at(&v, &["bliss", "vector"]),
            Some("0.1,0.2,0.3".to_string())
        );
    }

    #[test]
    fn vector_at_strings() {
        let v: Value =
            serde_json::from_str(r#"{"bliss": {"vector": ["0.1", "0.2", "0.3"]}}"#).unwrap();
        assert_eq!(
            vector_at(&v, &["bliss", "vector"]),
            Some("0.1,0.2,0.3".to_string())
        );
    }

    #[test]
    fn vector_at_mixed_types() {
        let v: Value =
            serde_json::from_str(r#"{"bliss": {"vector": [0.1, "0.2", 0.3]}}"#).unwrap();
        assert_eq!(
            vector_at(&v, &["bliss", "vector"]),
            Some("0.1,0.2,0.3".to_string())
        );
    }

    #[test]
    fn vector_at_empty_array() {
        let v: Value = serde_json::from_str(r#"{"bliss": {"vector": []}}"#).unwrap();
        assert_eq!(vector_at(&v, &["bliss", "vector"]), None);
    }

    #[test]
    fn vector_at_missing_key() {
        let v: Value = serde_json::from_str(r#"{"bliss": {}}"#).unwrap();
        assert_eq!(vector_at(&v, &["bliss", "vector"]), None);
    }

    #[test]
    fn vector_at_not_an_array() {
        let v: Value = serde_json::from_str(r#"{"bliss": {"vector": "not array"}}"#).unwrap();
        assert_eq!(vector_at(&v, &["bliss", "vector"]), None);
    }

    // ── image_mime ───────────────────────────────────────────────────

    #[test]
    fn image_mime_jpg() {
        assert_eq!(image_mime(Path::new("cover.jpg")), Some(MimeType::Jpeg));
        assert_eq!(image_mime(Path::new("cover.jpeg")), Some(MimeType::Jpeg));
        assert_eq!(
            image_mime(Path::new("cover.JPG")),
            Some(MimeType::Jpeg)
        );
    }

    #[test]
    fn image_mime_png() {
        assert_eq!(image_mime(Path::new("cover.png")), Some(MimeType::Png));
    }

    #[test]
    fn image_mime_gif() {
        assert_eq!(image_mime(Path::new("cover.gif")), Some(MimeType::Gif));
    }

    #[test]
    fn image_mime_bmp() {
        assert_eq!(image_mime(Path::new("cover.bmp")), Some(MimeType::Bmp));
    }

    #[test]
    fn image_mime_tiff() {
        assert_eq!(
            image_mime(Path::new("cover.tif")),
            Some(MimeType::Tiff)
        );
        assert_eq!(
            image_mime(Path::new("cover.tiff")),
            Some(MimeType::Tiff)
        );
    }

    #[test]
    fn image_mime_unknown_extension() {
        assert_eq!(image_mime(Path::new("cover.webp")), None);
    }

    #[test]
    fn image_mime_no_extension() {
        assert_eq!(image_mime(Path::new("cover")), None);
    }

    // ── push_if_some ─────────────────────────────────────────────────

    #[test]
    fn push_if_some_adds_non_empty() {
        let mut tags = Vec::new();
        push_if_some(&mut tags, "key1", Some("value".to_string()));
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0], ("key1".to_string(), "value".to_string()));
    }

    #[test]
    fn push_if_some_skips_none() {
        let mut tags = Vec::new();
        push_if_some(&mut tags, "key1", None);
        assert!(tags.is_empty());
    }

    #[test]
    fn push_if_some_trims_whitespace() {
        let mut tags = Vec::new();
        push_if_some(&mut tags, "key1", Some("  value  ".to_string()));
        assert_eq!(tags[0], ("key1".to_string(), "value".to_string()));
    }

    #[test]
    fn push_if_some_skips_empty_string() {
        let mut tags = Vec::new();
        push_if_some(&mut tags, "key1", Some("".to_string()));
        assert!(tags.is_empty());
    }

    #[test]
    fn push_if_some_skips_whitespace_only() {
        let mut tags = Vec::new();
        push_if_some(&mut tags, "key1", Some("   ".to_string()));
        assert!(tags.is_empty());
    }

    // ── preferred_tag_type ───────────────────────────────────────────

    #[test]
    fn preferred_tag_type_flac() {
        assert_eq!(
            preferred_tag_type(Path::new("song.flac"), None),
            Some(TagType::VorbisComments)
        );
    }

    #[test]
    fn preferred_tag_type_ogg() {
        assert_eq!(
            preferred_tag_type(Path::new("song.ogg"), None),
            Some(TagType::VorbisComments)
        );
    }

    #[test]
    fn preferred_tag_type_opus() {
        assert_eq!(
            preferred_tag_type(Path::new("song.opus"), None),
            Some(TagType::VorbisComments)
        );
    }

    #[test]
    fn preferred_tag_type_m4a() {
        assert_eq!(
            preferred_tag_type(Path::new("song.m4a"), None),
            Some(TagType::Mp4Ilst)
        );
    }

    #[test]
    fn preferred_tag_type_mp4() {
        assert_eq!(
            preferred_tag_type(Path::new("song.mp4"), None),
            Some(TagType::Mp4Ilst)
        );
    }

    #[test]
    fn preferred_tag_type_mp3() {
        assert_eq!(
            preferred_tag_type(Path::new("song.mp3"), None),
            Some(TagType::Id3v2)
        );
    }

    #[test]
    fn preferred_tag_type_wav_fallback() {
        assert_eq!(
            preferred_tag_type(Path::new("song.wav"), Some(TagType::Id3v2)),
            Some(TagType::Id3v2)
        );
    }

    #[test]
    fn preferred_tag_type_unknown_no_fallback() {
        assert_eq!(
            preferred_tag_type(Path::new("song.xyz"), None),
            None
        );
    }

    #[test]
    fn preferred_tag_type_no_extension_fallback() {
        assert_eq!(
            preferred_tag_type(Path::new("song"), Some(TagType::VorbisComments)),
            Some(TagType::VorbisComments)
        );
    }

    // ── supports_rich_writes ─────────────────────────────────────────

    #[test]
    fn supports_rich_writes_true_for_vorbis() {
        assert!(supports_rich_writes(TagType::VorbisComments));
    }

    #[test]
    fn supports_rich_writes_true_for_mp4() {
        assert!(supports_rich_writes(TagType::Mp4Ilst));
    }

    #[test]
    fn supports_rich_writes_true_for_id3v2() {
        assert!(supports_rich_writes(TagType::Id3v2));
    }

    #[test]
    fn supports_rich_writes_true_for_ape() {
        assert!(supports_rich_writes(TagType::Ape));
    }

    #[test]
    fn supports_rich_writes_false_for_riff_info() {
        assert!(!supports_rich_writes(TagType::RiffInfo));
    }

    #[test]
    fn supports_rich_writes_false_for_aiff_text() {
        assert!(!supports_rich_writes(TagType::AiffText));
    }

    #[test]
    fn supports_rich_writes_false_for_id3v1() {
        assert!(!supports_rich_writes(TagType::Id3v1));
    }

    // ── insert_custom_text ───────────────────────────────────────────

    #[test]
    fn insert_custom_text_vorbis() {
        let mut tag = Tag::new(TagType::VorbisComments);
        insert_custom_text(&mut tag, "crate_track_uid", "uid-123".to_string());
        let items: Vec<_> = tag
            .items()
            .filter(|item| {
                item.key()
                    .map_key(TagType::VorbisComments, true)
                    .unwrap_or("")
                    .contains("crate_track_uid")
            })
            .collect();
        assert_eq!(items.len(), 1, "Should insert one custom text item");
    }

    #[test]
    fn insert_custom_text_mp4ilist_uses_dashed_key() {
        let mut tag = Tag::new(TagType::Mp4Ilst);
        insert_custom_text(&mut tag, "crate_track_uid", "uid-456".to_string());
        let items: Vec<_> = tag
            .items()
            .filter(|item| {
                item.key()
                    .map_key(TagType::Mp4Ilst, true)
                    .unwrap_or("")
                    .contains("----:com.crate:crate_track_uid")
            })
            .collect();
        assert_eq!(items.len(), 1, "MP4 should use dashed key format");
    }

    // ── rich_tags ────────────────────────────────────────────────────

    #[test]
    fn rich_tags_basic_track() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-1",
                "artist_entity_uid": "artist-1",
                "album_entity_uid": "album-1"
            }"#,
        );
        let tags = rich_tags(&track, None);
        let keys: Vec<&str> = tags.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"crate_schema_version"));
        assert!(keys.contains(&"crate_artist_uid"));
        assert!(keys.contains(&"crate_album_uid"));
        assert!(keys.contains(&"crate_track_uid"));
    }

    #[test]
    fn rich_tags_with_fingerprint() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-2",
                "artist_entity_uid": "artist-2",
                "album_entity_uid": "album-2",
                "audio_fingerprint": "fp-abc",
                "audio_fingerprint_source": "chromaprint"
            }"#,
        );
        let tags = rich_tags(&track, None);
        let keys: Vec<&str> = tags.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"crate_audio_fingerprint"));
        assert!(keys.contains(&"crate_audio_fingerprint_source"));
    }

    #[test]
    fn rich_tags_with_lyrics() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-3",
                "artist_entity_uid": "artist-3",
                "album_entity_uid": "album-3",
                "lyrics": {
                    "plain": "la la la",
                    "synced": "[00:01] la la la"
                }
            }"#,
        );
        let tags = rich_tags(&track, None);
        let keys: Vec<&str> = tags.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"crate_plain_lyrics"));
        assert!(keys.contains(&"unsyncedlyrics"));
        assert!(keys.contains(&"crate_synced_lyrics"));
        assert!(keys.contains(&"syncedlyrics"));
    }

    #[test]
    fn rich_tags_with_plain_lyrics_alt_field() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-3a",
                "artist_entity_uid": "artist-3a",
                "album_entity_uid": "album-3a",
                "lyrics": {
                    "plainLyrics": "alt lyrics",
                    "syncedLyrics": "[00:02] alt"
                }
            }"#,
        );
        let tags = rich_tags(&track, None);
        let values: Vec<&str> = tags.iter().map(|(_, v)| v.as_str()).collect();
        assert!(values.contains(&"alt lyrics"));
        assert!(values.contains(&"[00:02] alt"));
    }

    #[test]
    fn rich_tags_with_package_fallback() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-4"
            }"#,
        );
        let package = json_from_str(
            r#"{
                "artist": {"entity_uid": "artist-from-pkg"},
                "album": {"entity_uid": "album-from-pkg"}
            }"#,
        );
        let tags = rich_tags(&track, Some(&package));
        let artist_tag = tags
            .iter()
            .find(|(k, _)| k == "crate_artist_uid")
            .map(|(_, v)| v.as_str());
        let album_tag = tags
            .iter()
            .find(|(k, _)| k == "crate_album_uid")
            .map(|(_, v)| v.as_str());
        assert_eq!(artist_tag, Some("artist-from-pkg"));
        assert_eq!(album_tag, Some("album-from-pkg"));
    }

    #[test]
    fn rich_tags_track_fields_override_package() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-5",
                "artist_entity_uid": "artist-from-track",
                "album_entity_uid": "album-from-track"
            }"#,
        );
        let package = json_from_str(
            r#"{
                "artist": {"entity_uid": "artist-from-pkg"},
                "album": {"entity_uid": "album-from-pkg"}
            }"#,
        );
        let tags = rich_tags(&track, Some(&package));
        let artist_tag = tags
            .iter()
            .find(|(k, _)| k == "crate_artist_uid")
            .map(|(_, v)| v.as_str());
        assert_eq!(artist_tag, Some("artist-from-track"));
    }

    #[test]
    fn rich_tags_with_analysis_json() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-6",
                "artist_entity_uid": "artist-6",
                "album_entity_uid": "album-6",
                "analysis": {
                    "bpm": 128.5,
                    "key": "Am"
                }
            }"#,
        );
        let tags = rich_tags(&track, None);
        assert!(
            tags.iter().any(|(k, _)| k == "crate_analysis_json"),
            "Should contain analysis JSON tag"
        );
    }

    #[test]
    fn rich_tags_empty_analysis_skipped() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-7",
                "artist_entity_uid": "artist-7",
                "album_entity_uid": "album-7",
                "analysis": {}
            }"#,
        );
        let tags = rich_tags(&track, None);
        assert!(
            !tags.iter().any(|(k, _)| k == "crate_analysis_json"),
            "Empty analysis should be skipped"
        );
    }

    #[test]
    fn rich_tags_with_bliss_vector() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-8",
                "artist_entity_uid": "artist-8",
                "album_entity_uid": "album-8",
                "bliss": {
                    "vector": [0.1, 0.2, 0.3, 0.4, 0.5]
                }
            }"#,
        );
        let tags = rich_tags(&track, None);
        let bliss_value = tags
            .iter()
            .find(|(k, _)| k == "crate_bliss_vector")
            .map(|(_, v)| v.as_str());
        assert_eq!(bliss_value, Some("0.1,0.2,0.3,0.4,0.5"));
    }

    #[test]
    fn rich_tags_empty_strings_filtered_out() {
        let track = json_from_str(
            r#"{
                "entity_uid": "track-9",
                "artist_entity_uid": "artist-9",
                "album_entity_uid": "",
                "audio_fingerprint": "   ",
                "lyrics": {
                    "plain": ""
                }
            }"#,
        );
        let tags = rich_tags(&track, None);
        assert!(
            !tags.iter().any(|(_, v)| v.is_empty()),
            "Empty/whitespace values should be filtered out"
        );
    }

    // ── write_rich_tags error paths ──────────────────────────────────

    #[test]
    fn write_rich_tags_missing_file() {
        let path = Path::new("/nonexistent/audio.flac");
        let track: Value = serde_json::from_str(r#"{"entity_uid":"t1"}"#).unwrap();
        let result = write_rich_tags(path, &track, None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn write_rich_tags_unsupported_format() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("empty.xyz");
        std::fs::write(&path, b"not-audio-data").unwrap();

        let track: Value = serde_json::from_str(r#"{"entity_uid":"t2"}"#).unwrap();
        let result = write_rich_tags(&path, &track, None, None);
        assert!(result.is_err(), "Should fail for file with unknown extension");
    }
}
