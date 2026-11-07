package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestConnectRedisURLReturnsConfigurationError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	client, err := connectRedisURL(
		context.Background(),
		"://invalid",
		time.Second,
		logger,
		"cache",
	)

	if err == nil {
		t.Fatal("expected invalid Redis URL to return an error")
	}
	if client != nil {
		t.Fatal("expected no Redis client after a configuration error")
	}
}

type fakeDrainer struct {
	shutdownErr error
	closeErr    error
	closed      bool
}

func (f *fakeDrainer) Shutdown(context.Context) error { return f.shutdownErr }

func (f *fakeDrainer) Close() error {
	f.closed = true
	return f.closeErr
}

func TestDrainHTTPServer(t *testing.T) {
	listenerErr := errors.New("close tcp [::]:8686: bad file descriptor")
	closeErr := errors.New("close tcp [::]:8686: input/output error")

	tests := []struct {
		name        string
		shutdownErr error
		closeErr    error
		wantForced  bool
		wantClosed  bool
		wantErr     error
	}{
		{
			name: "drained before the deadline",
		},
		{
			name:        "deadline reached is an orderly shutdown",
			shutdownErr: context.DeadlineExceeded,
			wantForced:  true,
			wantClosed:  true,
		},
		{
			name:        "wrapped deadline reached is an orderly shutdown",
			shutdownErr: fmt.Errorf("drain: %w", context.DeadlineExceeded),
			wantForced:  true,
			wantClosed:  true,
		},
		{
			name:        "listener already closed when force closing",
			shutdownErr: context.DeadlineExceeded,
			closeErr:    &net.OpError{Op: "close", Net: "tcp", Err: net.ErrClosed},
			wantForced:  true,
			wantClosed:  true,
		},
		{
			name:        "force close failure is reported",
			shutdownErr: context.DeadlineExceeded,
			closeErr:    closeErr,
			wantForced:  true,
			wantClosed:  true,
			wantErr:     closeErr,
		},
		{
			name:        "listener close failure is reported",
			shutdownErr: listenerErr,
			wantErr:     listenerErr,
		},
		{
			name:        "cancelled drain is reported",
			shutdownErr: context.Canceled,
			wantErr:     context.Canceled,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := &fakeDrainer{shutdownErr: test.shutdownErr, closeErr: test.closeErr}

			forced, err := drainHTTPServer(context.Background(), server)

			if forced != test.wantForced {
				t.Fatalf("forced = %v, want %v", forced, test.wantForced)
			}
			if server.closed != test.wantClosed {
				t.Fatalf("closed = %v, want %v", server.closed, test.wantClosed)
			}
			if !errors.Is(err, test.wantErr) || (err == nil) != (test.wantErr == nil) {
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
		})
	}
}

// TestDrainHTTPServerWithOpenEventStream reproduces CRATE-READPLANE-4: an open
// SSE subscriber keeps http.Server.Shutdown waiting until its context expires.
func TestDrainHTTPServerWithOpenEventStream(t *testing.T) {
	tests := []struct {
		name       string
		drain      func(context.Context, *http.Server) (bool, error)
		wantForced bool
		wantErr    error
	}{
		{
			name: "plain shutdown returns the deadline",
			drain: func(ctx context.Context, server *http.Server) (bool, error) {
				err := server.Shutdown(ctx)
				_ = server.Close()
				return false, err
			},
			wantErr: context.DeadlineExceeded,
		},
		{
			name: "drain closes the stream without an error",
			drain: func(ctx context.Context, server *http.Server) (bool, error) {
				return drainHTTPServer(ctx, server)
			},
			wantForced: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			streamOpen := make(chan struct{})
			streamDone := make(chan struct{})
			server := &http.Server{
				ReadHeaderTimeout: time.Second,
				Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					defer close(streamDone)
					w.Header().Set("Content-Type", "text/event-stream")
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
					close(streamOpen)
					<-r.Context().Done()
				}),
			}
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("listen: %v", err)
			}
			served := make(chan error, 1)
			go func() { served <- server.Serve(listener) }()

			conn, err := net.Dial("tcp", listener.Addr().String())
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer conn.Close()
			if _, err := fmt.Fprint(conn, "GET /api/cache/events HTTP/1.1\r\nHost: readplane\r\n\r\n"); err != nil {
				t.Fatalf("write request: %v", err)
			}
			if _, err := http.ReadResponse(bufio.NewReader(conn), nil); err != nil {
				t.Fatalf("read response headers: %v", err)
			}
			<-streamOpen

			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			forced, err := test.drain(ctx, server)

			if forced != test.wantForced {
				t.Fatalf("forced = %v, want %v", forced, test.wantForced)
			}
			if !errors.Is(err, test.wantErr) || (err == nil) != (test.wantErr == nil) {
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
			select {
			case <-streamDone:
			case <-time.After(2 * time.Second):
				t.Fatal("event stream handler still running after the drain")
			}
			if serveErr := <-served; !errors.Is(serveErr, http.ErrServerClosed) {
				t.Fatalf("Serve err = %v, want http.ErrServerClosed", serveErr)
			}
		})
	}
}
