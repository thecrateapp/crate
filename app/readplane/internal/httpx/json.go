package httpx

import (
	"encoding/json"
	"net/http"
)

// ErrorPayload is the standard JSON error response shape.
type ErrorPayload struct {
	Detail string `json:"detail"`
}

// WriteJSON marshals payload to JSON and writes it with the given HTTP status.
func WriteJSON(w http.ResponseWriter, status int, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, err = w.Write(body)
	return err
}

// WriteError writes a JSON error payload with the given status and message.
func WriteError(w http.ResponseWriter, status int, detail string) error {
	return WriteJSON(w, status, ErrorPayload{Detail: detail})
}

// MarkReadplane sets the X-Crate-Readplane header to indicate the response source.
func MarkReadplane(w http.ResponseWriter, source string) {
	w.Header().Set("X-Crate-Readplane", source)
}

// MarkVersion sets the X-Crate-Readplane-Version header.
func MarkVersion(w http.ResponseWriter, version string) {
	if version == "" {
		version = "dev"
	}
	w.Header().Set("X-Crate-Readplane-Version", version)
}
