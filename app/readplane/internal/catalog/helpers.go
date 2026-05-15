package catalog

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

var yearPrefixRE = regexp.MustCompile(`^\d{4}\s*[-–]\s*`)
var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func formatArtistTopTrack(row map[string]any) map[string]any {
	return map[string]any{
		"id":           stringValue(row["id"]),
		"track_id":     row["id"],
		"title":        row["title"],
		"artist":       row["artist"],
		"artist_id":    row["artist_id"],
		"artist_slug":  row["artist_slug"],
		"album":        row["album"],
		"album_id":     row["album_id"],
		"album_slug":   row["album_slug"],
		"duration":     firstNonNil(row["duration"], int64(0)),
		"track":        firstNonNil(row["track_number"], int64(0)),
		"format":       row["format"],
		"bpm":          row["bpm"],
		"audio_key":    row["audio_key"],
		"audio_scale":  row["audio_scale"],
		"energy":       row["energy"],
		"danceability": row["danceability"],
		"valence":      row["valence"],
		"bliss_vector": normalizeFloatSlice(row["bliss_vector"]),
	}
}

func serializeTrackInfo(row map[string]any) map[string]any {
	payload := cloneMap(row)
	delete(payload, "storage_id")
	delete(payload, "path")
	blissVector := payload["bliss_vector"]
	delete(payload, "bliss_vector")
	payload["bliss_signature"] = deriveBlissSignature(blissVector)
	return payload
}

func serializeEQFeatures(row map[string]any) map[string]any {
	return map[string]any{
		"energy":           row["energy"],
		"loudness":         row["loudness"],
		"dynamicRange":     row["dynamic_range"],
		"brightness":       row["spectral_complexity"],
		"danceability":     row["danceability"],
		"valence":          row["valence"],
		"acousticness":     row["acousticness"],
		"instrumentalness": row["instrumentalness"],
	}
}

func emptyTrackGenrePayload() map[string]any {
	return map[string]any{
		"primary":  nil,
		"topLevel": nil,
		"source":   nil,
		"preset":   nil,
	}
}

func playbackPayload(row map[string]any, requestedPolicy string) map[string]any {
	sourceFormat := inferFormat(stringValue(row["format"]), stringValue(row["path"]))
	source := map[string]any{
		"format":      sourceFormat,
		"bitrate":     bitrateKbps(row["bitrate"]),
		"sample_rate": row["sample_rate"],
		"bit_depth":   row["bit_depth"],
		"bytes":       row["size"],
		"lossless":    isLossless(sourceFormat),
	}
	return map[string]any{
		"stream_url":       streamURL(row, requestedPolicy),
		"requested_policy": "original",
		"effective_policy": "original",
		"source":           source,
		"delivery":         withReason(source, "original_requested"),
		"transcoded":       false,
		"cache_hit":        false,
		"preparing":        false,
		"task_id":          nil,
		"variant_id":       nil,
		"variant_status":   nil,
	}
}

func streamURL(row map[string]any, policy string) string {
	query := ""
	if policy != "" && policy != "original" {
		query = "?delivery=" + url.QueryEscape(policy)
	}
	if entityUID := stringValue(row["entity_uid"]); entityUID != "" {
		return "/api/tracks/by-entity/" + url.PathEscape(entityUID) + "/stream" + query
	}
	if id := intValue(row["id"]); id > 0 {
		return "/api/tracks/" + strconv.FormatInt(id, 10) + "/stream" + query
	}
	return "/api/stream/" + strings.TrimLeft(stringValue(row["path"]), "/") + query
}

func deriveBlissSignature(value any) map[string]any {
	values := normalizeFloatSlice(value)
	if len(values) == 0 {
		return nil
	}
	var sumAbs float64
	var maxAbs float64
	nonZero := 0
	for _, value := range values {
		abs := math.Abs(value)
		sumAbs += abs
		if abs > maxAbs {
			maxAbs = abs
		}
		if abs > 0.0001 {
			nonZero++
		}
	}
	meanAbs := sumAbs / float64(len(values))
	densityRaw := float64(nonZero) / float64(len(values))
	var textureRaw float64
	for i := 1; i < len(values); i++ {
		textureRaw += math.Abs(values[i] - values[i-1])
	}
	if len(values) > 1 {
		textureRaw /= float64(len(values) - 1)
	}
	half := max(1, len(values)/2)
	front := avg(values[:half])
	back := avg(values[half:])
	motionRaw := math.Abs(back - front)
	return map[string]any{
		"texture": roundFloat(math.Tanh(textureRaw*1.35), 3),
		"motion":  roundFloat(math.Tanh((motionRaw+meanAbs*0.35)*1.55), 3),
		"density": roundFloat(math.Tanh((densityRaw*0.9+meanAbs*0.5)*1.2), 3),
	}
}

func defaultLyrics() map[string]any {
	return map[string]any{
		"status":     "none",
		"found":      false,
		"has_plain":  false,
		"has_synced": false,
		"provider":   "lrclib",
		"updated_at": nil,
	}
}

func lyricsForTrack(items map[int64]map[string]any, trackID int64) map[string]any {
	if item, ok := items[trackID]; ok {
		return item
	}
	return defaultLyrics()
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func displayName(value string) string {
	return yearPrefixRE.ReplaceAllString(value, "")
}

func relativeMusicPath(path string) string {
	if strings.HasPrefix(path, "/music/") {
		return strings.TrimPrefix(path, "/music/")
	}
	return strings.TrimLeft(path, "/")
}

func looksLikeUUID(value string) bool {
	return uuidRE.MatchString(strings.TrimSpace(value))
}

func publicAlbumSlug(value string, artistSlug string) string {
	slug := slugify(displayName(value))
	prefix := slugify(artistSlug)
	if prefix != "" && strings.HasPrefix(slug, prefix+"-") {
		return strings.TrimPrefix(slug, prefix+"-")
	}
	return slug
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	previousDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			previousDash = false
			continue
		}
		if builder.Len() > 0 && !previousDash {
			builder.WriteByte('-')
			previousDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func normalizeFloatSlice(value any) []float64 {
	switch typed := value.(type) {
	case nil:
		return nil
	case []float64:
		return typed
	case []any:
		out := make([]float64, 0, len(typed))
		for _, item := range typed {
			out = append(out, floatValue(item))
		}
		return out
	default:
		return nil
	}
}

func inferFormat(format string, path string) string {
	cleaned := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
	if cleaned == "m4a" {
		return "aac"
	}
	if cleaned != "" {
		return cleaned
	}
	if index := strings.LastIndex(path, "."); index >= 0 && index < len(path)-1 {
		ext := strings.ToLower(path[index+1:])
		if ext == "m4a" {
			return "aac"
		}
		return ext
	}
	return ""
}

func bitrateKbps(value any) any {
	number := intValue(value)
	if number <= 0 {
		return nil
	}
	if number > 4000 {
		return int64(math.Round(float64(number) / 1000))
	}
	return number
}

func isLossless(format string) bool {
	switch strings.ToLower(format) {
	case "flac", "wav", "alac", "aiff", "aif":
		return true
	default:
		return false
	}
}

func withReason(input map[string]any, reason string) map[string]any {
	output := cloneMap(input)
	output["reason"] = reason
	return output
}
func historyFallbackKey(artist string, title string) string {
	return strings.TrimSpace(strings.ToLower(artist)) + "\x00" + strings.TrimSpace(strings.ToLower(title))
}
func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstN(value string, length int) string {
	if len(value) <= length {
		return value
	}
	return value[:length]
}

func anyStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		text := strings.TrimSpace(stringValue(value))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func intValue(value any) int64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case string:
		parsed, _ := strconv.ParseInt(typed, 10, 64)
		return parsed
	default:
		return 0
	}
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float32:
		return float64(typed)
	case float64:
		return typed
	case int:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, _ := strconv.ParseFloat(typed, 64)
		return parsed
	default:
		return 0
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case string:
		return typed == "true" || typed == "1"
	default:
		return false
	}
}

func roundFloat(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
}

func avg(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var total float64
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func clamp(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
func rowsToMaps(rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(values))
		for index, field := range fields {
			row[string(field.Name)] = normalizeValue(values[index])
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		var decoded any
		if json.Valid(typed) && json.Unmarshal(typed, &decoded) == nil {
			return decoded
		}
		return string(typed)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", typed[0:4], typed[4:6], typed[6:8], typed[8:10], typed[10:16])
	default:
		return value
	}
}
