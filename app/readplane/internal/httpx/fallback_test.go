package httpx

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSingleJoiningSlash(t *testing.T) {
	cases := []struct {
		a    string
		b    string
		want string
	}{
		{"", "/api/auth/me", "/api/auth/me"},
		{"/root", "/api/auth/me", "/root/api/auth/me"},
		{"/root/", "/api/auth/me", "/root/api/auth/me"},
		{"/root", "api/auth/me", "/root/api/auth/me"},
	}
	for _, tt := range cases {
		assert.Equal(t, tt.want, singleJoiningSlash(tt.a, tt.b))
	}
}
