package media

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Descriptor struct {
	MediaType       string
	RequestedPolicy string
	EffectivePolicy string
	SourceFormat    string
	DeliveryFormat  string
	DeliveryBitrate int64
	Transcoded      bool
	VariantStatus   string
	Observer        Observer
	Category        string
}

type Observer interface {
	Start()
	Finish(status int, bytes int64, ranged bool, category string)
}

type OpenLatencyObserver interface {
	RecordOpenLatency(milliseconds float64)
}

type countingResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *countingResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *countingResponseWriter) Write(content []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(content)
	w.bytes += int64(n)
	return n, err
}

func ServeFile(w http.ResponseWriter, r *http.Request, path string, descriptor Descriptor) error {
	openStarted := time.Now()
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	if observer, ok := descriptor.Observer.(OpenLatencyObserver); ok {
		observer.RecordOpenLatency(float64(time.Since(openStarted).Microseconds()) / 1000)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	mediaType := descriptor.MediaType
	if mediaType == "" {
		mediaType = mediaTypeForPath(path)
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", fmt.Sprintf(`W/"%x-%x"`, info.Size(), info.ModTime().UnixNano()))
	w.Header().Set("X-Crate-Readplane", "hit")
	if descriptor.RequestedPolicy != "" {
		w.Header().Set("X-Crate-Delivery-Policy", descriptor.RequestedPolicy)
		w.Header().Set("X-Crate-Delivery-Effective-Policy", descriptor.EffectivePolicy)
		w.Header().Set("X-Crate-Delivery-Format", descriptor.DeliveryFormat)
		w.Header().Set("X-Crate-Delivery-Bitrate", strconv.FormatInt(descriptor.DeliveryBitrate, 10))
		w.Header().Set("X-Crate-Source-Format", descriptor.SourceFormat)
		if descriptor.Transcoded {
			w.Header().Set("X-Crate-Transcoded", "1")
		} else {
			w.Header().Set("X-Crate-Transcoded", "0")
		}
		w.Header().Set("X-Crate-Variant-Status", descriptor.VariantStatus)
	}
	target := w
	var counted *countingResponseWriter
	if descriptor.Observer != nil {
		descriptor.Observer.Start()
		counted = &countingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		target = counted
		defer func() {
			descriptor.Observer.Finish(counted.status, counted.bytes, r.Header.Get("Range") != "", descriptor.Category)
		}()
	}
	http.ServeContent(target, r, filepath.Base(path), info.ModTime(), file)
	return nil
}

func mediaTypeForPath(path string) string {
	switch filepath.Ext(path) {
	case ".flac":
		return "audio/flac"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	case ".wav":
		return "audio/wav"
	case ".webp":
		return "image/webp"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	default:
		return "audio/mpeg"
	}
}
