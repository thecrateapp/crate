package observability

import (
	"errors"
	"reflect"
	"testing"

	"github.com/getsentry/sentry-go"
)

func TestLoadSentrySettings(t *testing.T) {
	t.Setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
	t.Setenv("SENTRY_ENVIRONMENT", "staging")
	t.Setenv("SENTRY_RELEASE", "crate-abc123")
	t.Setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")

	settings := LoadSentrySettings("readplane")

	if !settings.Enabled() {
		t.Fatal("expected Sentry to be enabled")
	}
	if settings.Service != "readplane" {
		t.Fatalf("service = %q, want readplane", settings.Service)
	}
	if settings.DSN != "https://public@example.ingest.sentry.io/1" {
		t.Fatalf("unexpected DSN: %q", settings.DSN)
	}
	if settings.Environment != "staging" {
		t.Fatalf("environment = %q, want staging", settings.Environment)
	}
	if settings.Release != "crate-abc123" {
		t.Fatalf("release = %q, want crate-abc123", settings.Release)
	}
	if settings.TracesSampleRate != 0.25 {
		t.Fatalf("trace sample rate = %v, want 0.25", settings.TracesSampleRate)
	}
}

func TestScrubEventDropsBenignHTTPAbortNoise(t *testing.T) {
	tests := []struct {
		name  string
		event *sentry.Event
		drop  bool
	}{
		{
			name:  "message",
			event: &sentry.Event{Message: "net/http: abort Handler"},
			drop:  true,
		},
		{
			name: "exception",
			event: &sentry.Event{Exception: []sentry.Exception{
				{Value: "net/http: abort Handler"},
			}},
			drop: true,
		},
		{
			name:  "real failure",
			event: &sentry.Event{Message: "upstream unavailable"},
			drop:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ScrubEvent(test.event, nil)
			if (got == nil) != test.drop {
				t.Fatalf("ScrubEvent() nil = %v, want drop %v", got == nil, test.drop)
			}
		})
	}
}

func TestCaptureOperationErrorUsesStableGroupingAndTags(t *testing.T) {
	transport := &sentry.MockTransport{}
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:       "https://public@example.ingest.sentry.io/1",
		Transport: transport,
	}); err != nil {
		t.Fatalf("init Sentry: %v", err)
	}

	errorValue := errors.New("upstream unavailable")
	CaptureOperationError(errorValue, "fallback.proxy", map[string]string{
		"route_class": "interactive",
	})

	events := transport.Events()
	if len(events) != 1 {
		t.Fatalf("captured %d events, want 1", len(events))
	}
	event := events[0]
	if len(event.Fingerprint) != 2 ||
		event.Fingerprint[0] != "readplane-operation-failure" ||
		event.Fingerprint[1] != "fallback.proxy" {
		t.Fatalf("unexpected fingerprint: %#v", event.Fingerprint)
	}
	if event.Tags["operation"] != "fallback.proxy" ||
		event.Tags["route_class"] != "interactive" {
		t.Fatalf("unexpected tags: %#v", event.Tags)
	}
	if len(event.Exception) != 1 || event.Exception[0].Value != errorValue.Error() {
		t.Fatalf("unexpected exception: %#v", event.Exception)
	}
}

func TestLoadSentrySettingsDisablesWithoutDSN(t *testing.T) {
	t.Setenv("SENTRY_DSN", "")

	settings := LoadSentrySettings("readplane")

	if settings.Enabled() {
		t.Fatal("expected Sentry to be disabled without a DSN")
	}
}

func TestLoadSentrySettingsClampsInvalidRate(t *testing.T) {
	t.Setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
	t.Setenv("SENTRY_TRACES_SAMPLE_RATE", "2")

	settings := LoadSentrySettings("readplane")

	if settings.TracesSampleRate != 1 {
		t.Fatalf("trace sample rate = %v, want 1", settings.TracesSampleRate)
	}
}

func TestScrubEventRedactsRequestCredentialsAndUserPII(t *testing.T) {
	event := &sentry.Event{
		Request: &sentry.Request{
			URL:         "https://api.example.test/api/stream?media_ticket=secret&artist=birds-in-row",
			QueryString: "media_ticket=secret&artist=birds-in-row",
			Cookies:     "session=secret",
			Headers: map[string]string{
				"Authorization": "Bearer secret",
				"Content-Type":  "application/json",
			},
		},
		User: sentry.User{ID: "42", Email: "user@example.test", IPAddress: "192.0.2.10"},
		Extra: map[string]interface{}{
			"refresh_token": "secret",
			"safe":          "kept",
		},
	}

	scrubbed := ScrubEvent(event, nil)

	if scrubbed.Request.URL != "https://api.example.test/api/stream?artist=birds-in-row&media_ticket=%5BFiltered%5D" {
		t.Fatalf("unexpected URL: %q", scrubbed.Request.URL)
	}
	if scrubbed.Request.QueryString != "artist=birds-in-row&media_ticket=%5BFiltered%5D" {
		t.Fatalf("unexpected query string: %q", scrubbed.Request.QueryString)
	}
	if scrubbed.Request.Cookies != "" {
		t.Fatalf("cookies should be removed, got %q", scrubbed.Request.Cookies)
	}
	if scrubbed.Request.Headers["Authorization"] != "[Filtered]" {
		t.Fatalf("authorization header was not redacted")
	}
	if scrubbed.Request.Headers["Content-Type"] != "application/json" {
		t.Fatalf("content type header should be preserved")
	}
	if scrubbed.User.ID != "42" || scrubbed.User.Email != "" || scrubbed.User.IPAddress != "" {
		t.Fatalf("unexpected user: %+v", scrubbed.User)
	}
	if scrubbed.Extra["refresh_token"] != "[Filtered]" || scrubbed.Extra["safe"] != "kept" {
		t.Fatalf("unexpected extra: %#v", scrubbed.Extra)
	}
}

func reportFromFallbackSite(err error) {
	CaptureOperationError(err, "fallback.proxy", map[string]string{"route_class": "interactive"})
}

func reportFromShutdownSite(err error) {
	CaptureOperationError(err, "shutdown.readplane", nil)
}

func TestCaptureOperationErrorReportsCallerAsTopFrame(t *testing.T) {
	tests := []struct {
		name       string
		report     func(error)
		operation  string
		wantCaller string
	}{
		{
			name:       "fallback call site",
			report:     reportFromFallbackSite,
			operation:  "fallback.proxy",
			wantCaller: "reportFromFallbackSite",
		},
		{
			name:       "shutdown call site",
			report:     reportFromShutdownSite,
			operation:  "shutdown.readplane",
			wantCaller: "reportFromShutdownSite",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transport := &sentry.MockTransport{}
			if err := sentry.Init(sentry.ClientOptions{
				Dsn:        "https://public@example.ingest.sentry.io/1",
				Transport:  transport,
				BeforeSend: beforeSend,
			}); err != nil {
				t.Fatalf("init Sentry: %v", err)
			}

			test.report(errors.New("context deadline exceeded"))

			events := transport.Events()
			if len(events) != 1 {
				t.Fatalf("captured %d events, want 1", len(events))
			}
			event := events[0]
			if len(event.Fingerprint) != 2 || event.Fingerprint[1] != test.operation {
				t.Fatalf("fingerprint = %#v, want operation %q", event.Fingerprint, test.operation)
			}
			if len(event.Exception) != 1 || event.Exception[0].Stacktrace == nil {
				t.Fatalf("expected one exception with a stack trace, got %#v", event.Exception)
			}
			frames := event.Exception[0].Stacktrace.Frames
			if len(frames) == 0 {
				t.Fatal("stack trace has no frames")
			}
			for _, frame := range frames {
				if frame.Module == observabilityPackage && frame.Function == captureHelperFunction {
					t.Fatalf("stack trace still contains the capture helper: %#v", frames)
				}
			}
			top := frames[len(frames)-1]
			if top.Module != observabilityPackage || top.Function != test.wantCaller {
				t.Fatalf("top frame = %s.%s, want %s.%s", top.Module, top.Function, observabilityPackage, test.wantCaller)
			}
			if !top.InApp {
				t.Fatalf("top frame %s is not marked in-app", top.Function)
			}
		})
	}
}

func TestTrimHelperFrames(t *testing.T) {
	caller := sentry.Frame{Module: readplaneModule + "/internal/httpx", Function: "(*FallbackProxy).newReverseProxy.func3"}
	helper := sentry.Frame{Module: observabilityPackage, Function: captureHelperFunction}
	closure := sentry.Frame{Module: observabilityPackage, Function: "func1"}
	handler := sentry.Frame{Module: readplaneModule + "/internal/routes", Function: "(*Server).homeDiscovery"}

	tests := []struct {
		name       string
		stacktrace *sentry.Stacktrace
		want       []sentry.Frame
	}{
		{
			name:       "nil stack trace",
			stacktrace: nil,
		},
		{
			name:       "helper and closure above the caller",
			stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{handler, caller, helper, closure}},
			want:       []sentry.Frame{handler, caller},
		},
		{
			name:       "stack carried by the error itself",
			stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{handler, caller}},
			want:       []sentry.Frame{handler, caller},
		},
		{
			name:       "helper with nothing below it is kept",
			stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{helper, closure}},
			want:       []sentry.Frame{helper, closure},
		},
		{
			name: "same function name in another package is kept",
			stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{
				caller,
				{Module: readplaneModule + "/internal/routes", Function: captureHelperFunction},
			}},
			want: []sentry.Frame{
				caller,
				{Module: readplaneModule + "/internal/routes", Function: captureHelperFunction},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			trimHelperFrames(test.stacktrace)

			if test.stacktrace == nil {
				return
			}
			if !reflect.DeepEqual(test.stacktrace.Frames, test.want) {
				t.Fatalf("frames = %#v, want %#v", test.stacktrace.Frames, test.want)
			}
		})
	}
}

func TestIsApplicationFrame(t *testing.T) {
	tests := []struct {
		name  string
		frame sentry.Frame
		want  bool
	}{
		{
			name: "readplane package in a trimpath build",
			frame: sentry.Frame{
				Module:   readplaneModule + "/internal/httpx",
				Filename: readplaneModule + "/internal/httpx/fallback.go",
			},
			want: true,
		},
		{
			name: "readplane package in a local build",
			frame: sentry.Frame{
				Module:  readplaneModule + "/internal/routes",
				AbsPath: "/src/internal/routes/server.go",
			},
			want: true,
		},
		{
			name: "service entrypoint",
			frame: sentry.Frame{
				Module:   "main",
				Filename: readplaneModule + "/cmd/crate-readplane/main.go",
			},
			want: true,
		},
		{
			name: "dependency closure inlined into main",
			frame: sentry.Frame{
				Module:   "main",
				Function: "WrapHTTP.(*Handler).Handle.(*Handler).handle.func6",
				Filename: "github.com/getsentry/sentry-go@v0.42.0/http/sentryhttp.go",
			},
			want: false,
		},
		{
			name: "dependency from the module cache",
			frame: sentry.Frame{
				Module:  "github.com/jackc/pgx/v5/pgxpool",
				AbsPath: "/go/pkg/mod/github.com/jackc/pgx/v5@v5.7.1/pgxpool/pool.go",
			},
			want: false,
		},
		{
			name: "standard library in a trimpath build",
			frame: sentry.Frame{
				Module:   "net/http/httputil",
				Filename: "net/http/httputil/reverseproxy.go",
			},
			want: false,
		},
		{
			name: "standard library in a local build",
			frame: sentry.Frame{
				Module:  "net/http",
				AbsPath: "/usr/local/go/src/net/http/server.go",
			},
			want: false,
		},
		{
			name:  "unknown frame",
			frame: sentry.Frame{Filename: "unknown"},
			want:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isApplicationFrame(test.frame); got != test.want {
				t.Fatalf("isApplicationFrame() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestBeforeSendMarksApplicationFramesAndKeepsScrubbing(t *testing.T) {
	stdlib := sentry.Frame{Module: "net/http", Filename: "net/http/server.go", InApp: true}
	app := sentry.Frame{Module: readplaneModule + "/internal/routes", Filename: readplaneModule + "/internal/routes/server.go"}

	tests := []struct {
		name        string
		event       *sentry.Event
		drop        bool
		wantInApp   []bool
		threadInApp []bool
	}{
		{
			name:  "benign abort is still dropped",
			event: &sentry.Event{Message: "net/http: abort Handler"},
			drop:  true,
		},
		{
			name: "exception frames are classified",
			event: &sentry.Event{Exception: []sentry.Exception{{
				Value:      "context deadline exceeded",
				Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{stdlib, app}},
			}}},
			wantInApp: []bool{false, true},
		},
		{
			name: "thread frames are classified",
			event: &sentry.Event{
				Message: "panic",
				Threads: []sentry.Thread{{Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{stdlib, app}}}},
			},
			threadInApp: []bool{false, true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := beforeSend(test.event, nil)

			if (got == nil) != test.drop {
				t.Fatalf("beforeSend() nil = %v, want drop %v", got == nil, test.drop)
			}
			if got == nil {
				return
			}
			if test.wantInApp != nil {
				assertInApp(t, got.Exception[0].Stacktrace.Frames, test.wantInApp)
			}
			if test.threadInApp != nil {
				assertInApp(t, got.Threads[0].Stacktrace.Frames, test.threadInApp)
			}
		})
	}
}

func assertInApp(t *testing.T, frames []sentry.Frame, want []bool) {
	t.Helper()
	if len(frames) != len(want) {
		t.Fatalf("got %d frames, want %d", len(frames), len(want))
	}
	for index, frame := range frames {
		if frame.InApp != want[index] {
			t.Fatalf("frame %d (%s) InApp = %v, want %v", index, frame.Module, frame.InApp, want[index])
		}
	}
}

func TestObservabilityPackageMatchesImportPath(t *testing.T) {
	if got := reflect.TypeOf(SentrySettings{}).PkgPath(); got != observabilityPackage {
		t.Fatalf("observabilityPackage = %q, but this package is %q", observabilityPackage, got)
	}
}
