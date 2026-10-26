package secrets

import (
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func TestGenerate(t *testing.T) {
	cases := []struct {
		format string
		bytes  int
		decode func(string) ([]byte, error)
	}{
		{"hex16", 16, hex.DecodeString},
		{"hex32", 32, hex.DecodeString},
		{"fernet", 32, base64.URLEncoding.DecodeString},
	}
	for _, tc := range cases {
		t.Run(tc.format, func(t *testing.T) {
			first, err := Generate(tc.format)
			if err != nil {
				t.Fatal(err)
			}
			second, _ := Generate(tc.format)
			if first == second {
				t.Fatal("two generated secrets are equal")
			}
			raw, err := tc.decode(first)
			if err != nil {
				t.Fatalf("decode %q: %v", first, err)
			}
			if len(raw) != tc.bytes {
				t.Fatalf("got %d bytes, want %d", len(raw), tc.bytes)
			}
		})
	}
}

func TestGenerateRejectsUnknownFormats(t *testing.T) {
	if _, err := Generate("base32"); err == nil {
		t.Fatal("expected an error")
	}
}
