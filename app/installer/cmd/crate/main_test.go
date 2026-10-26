package main

import (
	"bytes"
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
