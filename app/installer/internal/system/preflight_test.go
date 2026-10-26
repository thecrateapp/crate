package system

import (
	"net"
	"testing"
)

func TestArchitectureCheck(t *testing.T) {
	cases := []struct {
		host Host
		want Status
	}{
		{Host{OS: "linux", Arch: "amd64"}, OK},
		{Host{OS: "darwin", Arch: "arm64"}, Warn},
		{Host{OS: "linux", Arch: "arm64"}, Warn},
		{Host{OS: "linux", Arch: "386"}, Fail},
	}
	for _, tc := range cases {
		if got := ArchitectureCheck(tc.host).Status; got != tc.want {
			t.Errorf("%s/%s: got %v, want %v", tc.host.OS, tc.host.Arch, got, tc.want)
		}
	}
}

func TestMemoryCheck(t *testing.T) {
	cases := map[float64]Status{0: Warn, 2: Warn, 6: Warn, 8: OK, 32: OK}
	for gb, want := range cases {
		if got := MemoryCheck(Host{MemoryGB: gb}).Status; got != want {
			t.Errorf("%.0f GB: got %v, want %v", gb, got, want)
		}
	}
}

func TestPortsCheckFindsABusyPort(t *testing.T) {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port

	check := PortsCheck(map[string]int{"API": port})

	if check.Status != Warn {
		t.Fatalf("got %v, want Warn", check.Status)
	}
}

func TestDiskCheckMeasuresTheClosestExistingParent(t *testing.T) {
	check := DiskCheck(t.TempDir() + "/not/created/yet")
	if check.Detail == "could not be measured" {
		t.Fatal("expected a measurement")
	}
}
