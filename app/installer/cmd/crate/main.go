// Command crate installs and configures a Crate home server.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/wizard"
)

var version = "dev"

const usage = `crate sets up and configures a Crate home server.

Usage:
  crate install [flags]   install Crate, or change an existing installation
  crate version           print the installer version

Run "crate install --help" for the install flags.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "install":
		return runInstall(args[1:], stderr)
	case "version", "--version":
		fmt.Fprintln(stdout, version)
		return 0
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	}
	fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
	return 2
}

func envFlag(name string) bool {
	return os.Getenv(name) == "1"
}

func defaultInstallDir() string {
	if dir := os.Getenv("CRATE_INSTALL_DIR"); dir != "" {
		return dir
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "crate")
	}
	return "crate"
}

func parseInstallFlags(args []string, stderr io.Writer) (wizard.Options, error) {
	opts := wizard.Options{Version: version}
	flags := flag.NewFlagSet("crate install", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.InstallDir, "dir", defaultInstallDir(), "install folder (CRATE_INSTALL_DIR)")
	flags.BoolVar(&opts.Yes, "yes", envFlag("CRATE_ASSUME_YES"), "never ask; use defaults and CRATE_* environment overrides (CRATE_ASSUME_YES=1)")
	flags.BoolVar(&opts.DryRun, "dry-run", envFlag("CRATE_DRY_RUN"), "show what would happen without writing anything (CRATE_DRY_RUN=1)")
	flags.BoolVar(&opts.SkipStart, "skip-start", envFlag("CRATE_SKIP_START"), "write the files but do not start Crate (CRATE_SKIP_START=1)")
	flags.BoolVar(&opts.Accessible, "accessible", envFlag("ACCESSIBLE"), "plain prompts that work with screen readers")
	err := flags.Parse(args)
	return opts, err
}

func runInstall(args []string, stderr io.Writer) int {
	opts, err := parseInstallFlags(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := wizard.Run(ctx, opts); err != nil {
		fmt.Fprintln(stderr)
		if errors.Is(err, wizard.ErrCancelled) {
			ui.Warning(stderr, "Installation cancelled. Nothing else was changed; run `crate install` to pick up where you left off.")
			return 130
		}
		ui.Failure(stderr, err.Error())
		return 1
	}
	return 0
}
