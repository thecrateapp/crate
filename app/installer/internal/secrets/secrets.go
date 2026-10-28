// Package secrets creates the credentials an installation generates once.
package secrets

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// Generate returns a new random value in one of the manifest formats:
// hex16 and hex32 are that many random bytes in hex; fernet is the
// url-safe base64 key Python's cryptography.Fernet expects.
func Generate(format string) (string, error) {
	switch format {
	case "hex16":
		return randomHex(16)
	case "hex32":
		return randomHex(32)
	case "fernet":
		key, err := randomBytes(32)
		if err != nil {
			return "", err
		}
		return base64.URLEncoding.EncodeToString(key), nil
	default:
		return "", fmt.Errorf("unknown secret format %q", format)
	}
}

// Password returns a random password that is easy to copy by hand.
func Password() (string, error) {
	value, err := randomHex(12)
	if err != nil {
		return "", err
	}
	return value, nil
}

func randomHex(size int) (string, error) {
	data, err := randomBytes(size)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func randomBytes(size int) ([]byte, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return nil, fmt.Errorf("read random bytes: %w", err)
	}
	return data, nil
}
