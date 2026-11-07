package observability

import (
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
)

const defaultTraceSampleRate = 0.1

// readplaneModule is this service's Go module path. Stack frames from it are
// application code; the standard library and dependencies are not.
const readplaneModule = "github.com/thecrateapp/crate/app/readplane"

// observabilityPackage is this package's import path. Its capture helpers must
// not become the top frame (and so the culprit) of the events they report.
const observabilityPackage = readplaneModule + "/internal/observability"

// captureHelperFunction is the frame trimmed, with everything above it, from
// the stack traces recorded by CaptureOperationError.
const captureHelperFunction = "CaptureOperationError"

var sensitiveQueryKeys = map[string]struct{}{
	"access_token":  {},
	"api_key":       {},
	"code":          {},
	"media_ticket":  {},
	"password":      {},
	"refresh_token": {},
	"secret":        {},
	"session":       {},
	"signature":     {},
	"state":         {},
	"token":         {},
}

var sensitiveHeaderKeys = map[string]struct{}{
	"authorization":       {},
	"cookie":              {},
	"proxy-authorization": {},
	"x-api-key":           {},
}

// SentrySettings contains the runtime configuration for one service.
type SentrySettings struct {
	Service            string
	DSN                string
	Environment        string
	Release            string
	TracesSampleRate   float64
	ProfilesSampleRate float64
}

func (settings SentrySettings) Enabled() bool {
	return settings.DSN != ""
}

// LoadSentrySettings reads configuration without requiring Sentry to be enabled.
func LoadSentrySettings(service string) SentrySettings {
	dsn := strings.TrimSpace(os.Getenv("SENTRY_DSN"))
	if disabled(os.Getenv("SENTRY_ENABLED")) {
		dsn = ""
	}

	environment := firstNonEmpty(
		os.Getenv("SENTRY_ENVIRONMENT"),
		os.Getenv("CRATE_ENV"),
		"development",
	)
	release := strings.TrimSpace(os.Getenv("SENTRY_RELEASE"))
	if release == "" {
		release = strings.TrimSpace(os.Getenv("GITHUB_SHA"))
		if release != "" {
			release = "crate-" + release
		}
	}

	return SentrySettings{
		Service:            service,
		DSN:                dsn,
		Environment:        environment,
		Release:            release,
		TracesSampleRate:   sampleRate("SENTRY_TRACES_SAMPLE_RATE", defaultTraceSampleRate),
		ProfilesSampleRate: sampleRate("SENTRY_PROFILES_SAMPLE_RATE", 0),
	}
}

// InitSentry initializes the process-wide SDK. Observability errors never stop
// the readplane from serving traffic, so callers should log the returned error.
func InitSentry(service string) (bool, func(), error) {
	settings := LoadSentrySettings(service)
	if !settings.Enabled() {
		return false, func() {}, nil
	}

	options := sentry.ClientOptions{
		Dsn:                   settings.DSN,
		Environment:           settings.Environment,
		Release:               settings.Release,
		EnableTracing:         settings.TracesSampleRate > 0,
		TracesSampleRate:      settings.TracesSampleRate,
		SampleRate:            1,
		SendDefaultPII:        false,
		BeforeSend:            beforeSend,
		BeforeSendTransaction: ScrubEvent,
		MaxBreadcrumbs:        50,
	}
	if err := sentry.Init(options); err != nil {
		return false, func() {}, err
	}
	sentry.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetTag("service", settings.Service)
	})

	return true, func() { sentry.Flush(2 * time.Second) }, nil
}

// WrapHTTP adds request transactions and panic recovery to a net/http handler.
func WrapHTTP(handler http.Handler) http.Handler {
	return sentryhttp.New(sentryhttp.Options{
		Repanic:         true,
		WaitForDelivery: false,
	}).Handle(handler)
}

// CaptureOperationError reports a handled runtime failure with stable grouping.
// The reported stack trace ends at the caller, so the Sentry culprit is the
// code that hit the failure rather than this helper.
func CaptureOperationError(err error, operation string, tags map[string]string) *sentry.EventID {
	if err == nil {
		return nil
	}
	normalizedOperation := strings.TrimSpace(operation)
	if normalizedOperation == "" {
		normalizedOperation = "unknown"
	}

	var eventID *sentry.EventID
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetFingerprint([]string{"readplane-operation-failure", normalizedOperation})
		scope.SetTag("operation", normalizedOperation)
		for key, value := range tags {
			scope.SetTag(key, value)
		}
		scope.AddEventProcessor(trimCaptureHelperFrames)
		eventID = sentry.CaptureException(err)
	})
	return eventID
}

// trimCaptureHelperFrames drops CaptureOperationError and its WithScope closure
// from the stack trace the SDK records at capture time. Without this the top
// frame of every operation event is the closure, and Sentry names it culprit.
func trimCaptureHelperFrames(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	for index := range event.Exception {
		trimHelperFrames(event.Exception[index].Stacktrace)
	}
	return event
}

// trimHelperFrames cuts the stack at the innermost CaptureOperationError frame.
// Stacks carried by the error itself (pkg/errors and similar) never contain it
// and are left alone; a stack with no frame below the helper is kept as is.
func trimHelperFrames(stacktrace *sentry.Stacktrace) {
	if stacktrace == nil {
		return
	}
	for index := len(stacktrace.Frames) - 1; index > 0; index-- {
		frame := stacktrace.Frames[index]
		if frame.Module == observabilityPackage && frame.Function == captureHelperFunction {
			stacktrace.Frames = stacktrace.Frames[:index]
			return
		}
	}
}

// beforeSend scrubs an error event, then marks which frames are application code.
func beforeSend(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
	event = ScrubEvent(event, hint)
	if event != nil {
		markApplicationFrames(event)
	}
	return event
}

// markApplicationFrames sets InApp from each frame's package. The SDK decides
// InApp by comparing file paths with GOROOT, which is empty in the -trimpath
// binary on the distroless image, so it marks every frame as library code and
// Sentry falls back to the topmost frame for the culprit and grouping display.
func markApplicationFrames(event *sentry.Event) {
	for index := range event.Exception {
		markStacktraceFrames(event.Exception[index].Stacktrace)
	}
	for index := range event.Threads {
		markStacktraceFrames(event.Threads[index].Stacktrace)
	}
}

func markStacktraceFrames(stacktrace *sentry.Stacktrace) {
	if stacktrace == nil {
		return
	}
	for index := range stacktrace.Frames {
		stacktrace.Frames[index].InApp = isApplicationFrame(stacktrace.Frames[index])
	}
}

// isApplicationFrame reports whether a frame comes from this module. Dependency
// sources sit under a versioned module path ("module@version/..."), both in
// -trimpath file names and in the module cache; the path check runs first
// because closures inlined from a dependency into package main (the sentryhttp
// handler, for one) carry the "main" package name.
func isApplicationFrame(frame sentry.Frame) bool {
	if strings.Contains(frame.Filename, "@") || strings.Contains(frame.AbsPath, "@") {
		return false
	}
	return frame.Module == "main" || strings.HasPrefix(frame.Module, readplaneModule+"/")
}

// ScrubEvent removes credentials and user-identifying data before sending.
func ScrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	if isBenignHTTPAbort(event) {
		return nil
	}
	if event.Request != nil {
		event.Request.URL = scrubURL(event.Request.URL)
		event.Request.QueryString = scrubQuery(event.Request.QueryString)
		event.Request.Cookies = ""
		event.Request.Data = ""
		for key := range event.Request.Headers {
			if _, ok := sensitiveHeaderKeys[strings.ToLower(key)]; ok {
				event.Request.Headers[key] = "[Filtered]"
			}
		}
	}
	event.User.Email = ""
	event.User.IPAddress = ""
	event.User.Username = ""
	event.User.Name = ""
	event.User.Data = nil
	event.Extra = scrubMap(event.Extra).(map[string]interface{})
	for key, context := range event.Contexts {
		event.Contexts[key] = scrubMap(context).(map[string]interface{})
	}
	for key, value := range event.Tags {
		if sensitiveKey(key) {
			event.Tags[key] = "[Filtered]"
		} else {
			event.Tags[key] = value
		}
	}
	return event
}

func isBenignHTTPAbort(event *sentry.Event) bool {
	const abortMessage = "net/http: abort Handler"
	if strings.TrimSpace(event.Message) == abortMessage {
		return true
	}
	for _, exception := range event.Exception {
		if strings.TrimSpace(exception.Value) == abortMessage {
			return true
		}
	}
	return false
}

func sampleRate(name string, fallback float64) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(name)), 64)
	if err != nil {
		value = fallback
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func disabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "no", "off":
		return true
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func sensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	if normalized == "cookies" || normalized == "set_cookie" {
		return true
	}
	for _, part := range []string{"authorization", "cookie", "credential", "password", "secret", "token"} {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

func scrubURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.RawQuery == "" {
		return raw
	}
	parsed.RawQuery = scrubQuery(parsed.RawQuery)
	return parsed.String()
}

func scrubQuery(raw string) string {
	if raw == "" {
		return ""
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return raw
	}
	for key := range values {
		if _, ok := sensitiveQueryKeys[strings.ToLower(key)]; ok {
			values.Set(key, "[Filtered]")
		}
	}
	return values.Encode()
}

func scrubMap(values map[string]interface{}) interface{} {
	if values == nil {
		return map[string]interface{}{}
	}
	result := make(map[string]interface{}, len(values))
	for key, value := range values {
		if sensitiveKey(key) {
			result[key] = "[Filtered]"
			continue
		}
		switch nested := value.(type) {
		case map[string]interface{}:
			result[key] = scrubMap(nested)
		case []interface{}:
			items := make([]interface{}, len(nested))
			for index, item := range nested {
				if child, ok := item.(map[string]interface{}); ok {
					items[index] = scrubMap(child)
				} else {
					items[index] = item
				}
			}
			result[key] = items
		default:
			result[key] = value
		}
	}
	return result
}
