package validate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCloudflareToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user/tokens/verify" {
			http.NotFound(w, r)
			return
		}
		switch r.Header.Get("Authorization") {
		case "Bearer good":
			w.Write([]byte(`{"success":true,"result":{"status":"active"}}`))
		case "Bearer expired":
			w.Write([]byte(`{"success":true,"result":{"status":"expired"}}`))
		default:
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"success":false,"errors":[{"code":1000}]}`))
		}
	}))
	defer server.Close()
	client := Client{HTTP: server.Client(), Cloudflare: server.URL}

	if err := client.CloudflareToken(context.Background(), "good"); err != nil {
		t.Errorf("good token: %v", err)
	}
	for _, token := range []string{"expired", "wrong"} {
		if err := client.CloudflareToken(context.Background(), token); !errors.Is(err, ErrRejected) {
			t.Errorf("%s token: got %v, want ErrRejected", token, err)
		}
	}
}
