package main

import (
	"bytes"
	"flag"
	"strings"
	"testing"
)

func TestParseInstallFlagsHonoursInstallShVariables(t *testing.T) {
	t.Setenv("CRATE_ASSUME_YES", "1")
	t.Setenv("CRATE_DRY_RUN", "1")
	t.Setenv("CRATE_INSTALL_DIR", "/srv/crate")

	opts, err := parseInstallFlags(nil, &bytes.Buffer{})

	if err != nil {
		t.Fatal(err)
	}
	if !opts.Yes || !opts.DryRun || opts.SkipStart || opts.InstallDir != "/srv/crate" {
		t.Fatalf("got %+v", opts)
	}
}

func TestFlagsOverrideTheEnvironment(t *testing.T) {
	t.Setenv("CRATE_INSTALL_DIR", "/srv/crate")

	opts, err := parseInstallFlags([]string{"--dir", "/opt/crate", "--skip-start"}, &bytes.Buffer{})

	if err != nil || opts.InstallDir != "/opt/crate" || !opts.SkipStart {
		t.Fatalf("got %+v, %v", opts, err)
	}
}

func TestRunRejectsUnknownCommands(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"deploy"}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "unknown command") {
		t.Fatalf("code %d, stderr %q", code, stderr.String())
	}
	if code := run([]string{"version"}, &stdout, &stderr); code != 0 || strings.TrimSpace(stdout.String()) != "dev" {
		t.Fatalf("version: code %d, out %q", code, stdout.String())
	}
}

func TestParseInterspersedAcceptsFlagsAfterArguments(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	dir := flags.String("dir", "", "")
	ids, err := parseInterspersed(flags, []string{"lastfm", "--dir", "/srv/crate", "telegram"})
	if err != nil || *dir != "/srv/crate" || strings.Join(ids, ",") != "lastfm,telegram" {
		t.Fatalf("ids %v, dir %q, err %v", ids, *dir, err)
	}
}

func TestDoctorFailsWithoutAnInstallation(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"doctor", "--json", "--dir", t.TempDir()}, &stdout, &stderr)
	if code != 1 || !strings.Contains(stdout.String(), `"healthy": false`) {
		t.Fatalf("code %d, out %s, err %s", code, stdout.String(), stderr.String())
	}
}
