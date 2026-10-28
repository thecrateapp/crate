package install

import "testing"

func TestUpgradeImageTag(t *testing.T) {
	cases := []struct {
		name, current, version, want string
	}{
		{"a release pins a new install", "", "v3.0.0", "v3.0.0"},
		{"a release moves latest", "latest", "v3.0.0", "v3.0.0"},
		{"a release moves an older release", "v3.0.0", "v3.1.0", "v3.1.0"},
		{"versions compare as numbers", "v3.9.0", "v3.10.0", "v3.10.0"},
		{"the same release stays", "v3.1.0", "v3.1.0", "v3.1.0"},
		{"an older installer never downgrades", "v3.2.0", "v3.1.5", "v3.2.0"},
		{"a commit sha is kept", "2734413f2a1b", "v3.1.0", "2734413f2a1b"},
		{"a custom tag is kept", "edge", "v3.1.0", "edge"},
		{"a pre-release tag is kept", "v3.2.0-rc.1", "v3.1.0", "v3.2.0-rc.1"},
		{"a dev build installs latest", "", "dev", "latest"},
		{"a dev build keeps a release", "v3.0.0", "dev", "v3.0.0"},
		{"a pre-release installer does not pin", "", "v3.1.0-rc.1", "latest"},
		{"a pre-release installer keeps a release", "v3.0.0", "v3.1.0-rc.1", "v3.0.0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := UpgradeImageTag(tc.current, tc.version); got != tc.want {
				t.Fatalf("UpgradeImageTag(%q, %q) = %q, want %q", tc.current, tc.version, got, tc.want)
			}
		})
	}
}
