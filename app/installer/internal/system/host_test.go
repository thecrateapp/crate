package system

import (
	"strings"
	"testing"
)

func TestParseMemTotal(t *testing.T) {
	got := parseMemTotal(strings.NewReader("MemTotal:       16303540 kB\nMemFree: 1 kB\n"))
	if got < 15.5 || got > 15.6 {
		t.Fatalf("got %.2f GB", got)
	}
	if parseMemTotal(strings.NewReader("nothing\n")) != 0 {
		t.Fatal("expected 0 without MemTotal")
	}
}

func TestZoneFromLocaltime(t *testing.T) {
	cases := map[string]string{
		"/var/db/timezone/zoneinfo/Europe/Madrid": "Europe/Madrid",
		"../usr/share/zoneinfo/America/New_York":  "America/New_York",
		"/etc/localtime-copy":                     "",
	}
	for target, want := range cases {
		if got := zoneFromLocaltime(target); got != want {
			t.Errorf("%s: got %q, want %q", target, got, want)
		}
	}
}
