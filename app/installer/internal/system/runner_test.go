package system

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestRunHandsTheEnvironmentAndInputToTheCommand(t *testing.T) {
	cases := []struct {
		name    string
		script  string
		env     []string
		stdin   string
		out     string
		failure string
	}{
		{"environment", `printf %s "$CRATE_TEST_VALUE"`, []string{"CRATE_TEST_VALUE=from-env"}, "", "from-env", ""},
		{"input", `cat`, nil, "typed", "typed", ""},
		{"failure", `echo first >&2; echo "the last line" >&2; exit 3`, nil, "", "", "the last line"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			err := ExecRunner{}.Run(context.Background(), Command{
				Name: "sh", Args: []string{"-c", tc.script}, Env: tc.env, Stdin: strings.NewReader(tc.stdin), Out: &out,
			})
			if tc.failure == "" {
				if err != nil || out.String() != tc.out {
					t.Fatalf("out %q, err %v", out.String(), err)
				}
				return
			}
			var failed *CommandError
			if !errors.As(err, &failed) || failed.Stderr != tc.failure {
				t.Fatalf("got %v", err)
			}
		})
	}
}
