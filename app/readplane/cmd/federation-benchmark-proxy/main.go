package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	readplanefederation "github.com/thecrateapp/crate/app/readplane/internal/federation"
)

const benchmarkTicketUID = "11111111-1111-4111-8111-111111111111"

func main() {
	addr := getenv("BENCHMARK_ADDR", "127.0.0.1:18787")
	controlPlane := getenv("BENCHMARK_CONTROL_PLANE", "http://127.0.0.1:18786")
	token := getenv("BENCHMARK_SERVICE_TOKEN", "benchmark-readplane-service-token-32-bytes")
	signer, err := readplanefederation.NewControlPlaneSigner(controlPlane, token, 2*time.Second)
	if err != nil {
		log.Fatal(err)
	}
	proxy := readplanefederation.NewProxy(
		readplanefederation.ProxyConfig{
			AllowPrivateNetworks:  true,
			ConnectTimeout:        2 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
		},
		signer,
		nil,
		nil,
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/metadata", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
	mux.HandleFunc("/remote", func(w http.ResponseWriter, request *http.Request) {
		proxy.ServeHTTP(w, request, 7, benchmarkTicketUID)
	})
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("federation benchmark proxy listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}

func getenv(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
