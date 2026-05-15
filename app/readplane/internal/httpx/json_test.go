package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSONReturnsErrorOnUnserializablePayload(t *testing.T) {
	rec := httptest.NewRecorder()
	err := WriteJSON(rec, http.StatusOK, make(chan int))
	if err == nil {
		t.Fatal("expected error for unserializable payload")
	}
}

func TestWriteJSONWritesPayload(t *testing.T) {
	rec := httptest.NewRecorder()
	if err := WriteJSON(rec, http.StatusOK, map[string]any{"ok": true}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	if body != `{"ok":true}` {
		t.Fatalf("body = %q", body)
	}
}

func TestWriteErrorWritesPayload(t *testing.T) {
	rec := httptest.NewRecorder()
	if err := WriteError(rec, http.StatusNotFound, "not found"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	body := rec.Body.String()
	if body != `{"detail":"not found"}` {
		t.Fatalf("body = %q", body)
	}
}
