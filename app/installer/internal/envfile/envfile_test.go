package envfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestQuoteRoundTrips(t *testing.T) {
	values := []string{
		"plain",
		`with "quotes"`,
		`dollar $HOME and ${VAR}`,
		"back`tick",
		`back\slash`,
		"",
		"line\nbreak",
	}
	for _, value := range values {
		parsed, err := Parse(strings.NewReader("KEY=" + Quote(value) + "\n"))
		if err != nil {
			t.Fatalf("%q: %v", value, err)
		}
		got, _ := parsed.Get("KEY")
		if got != value {
			t.Fatalf("round trip of %q gave %q", value, got)
		}
	}
}

func TestParseAcceptsTheFormsUsersWrite(t *testing.T) {
	parsed, err := Parse(strings.NewReader(`# comment
export TZ=Europe/Madrid
PLAIN=value # trailing comment
SINGLE='it is $literal'
EMPTY=
`))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"TZ":     "Europe/Madrid",
		"PLAIN":  "value",
		"SINGLE": "it is $literal",
		"EMPTY":  "",
	}
	for key, value := range want {
		if got, _ := parsed.Get(key); got != value {
			t.Errorf("%s = %q, want %q", key, got, value)
		}
	}
	if strings.Join(parsed.Keys(), ",") != "TZ,PLAIN,SINGLE,EMPTY" {
		t.Errorf("order not preserved: %v", parsed.Keys())
	}
}

func TestRenderKeepsKeysOutsideTheSections(t *testing.T) {
	values := New()
	values.Set("TZ", "UTC")
	values.Set("MY_TWEAK", "1")
	out := Render(values, "# Crate\n", []Section{{Title: "Basics", Keys: []string{"TZ", "MISSING"}}})
	if !strings.Contains(out, "# Basics\nTZ=\"UTC\"") {
		t.Errorf("basics block missing:\n%s", out)
	}
	if !strings.Contains(out, "# Other settings\nMY_TWEAK=\"1\"") {
		t.Errorf("user key dropped:\n%s", out)
	}
	if strings.Contains(out, "MISSING") {
		t.Errorf("absent key written:\n%s", out)
	}
}

func TestWriteIsOwnerOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := Write(path, "A=\"1\"\n"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v, want 0600", info.Mode().Perm())
	}
}
