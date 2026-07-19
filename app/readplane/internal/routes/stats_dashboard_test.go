package routes

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatsDashboardSubjectKey(t *testing.T) {
	tests := []struct {
		name    string
		userID  int64
		query   url.Values
		want    string
		wantErr bool
	}{
		{
			name:   "defaults",
			userID: 17,
			query:  url.Values{},
			want:   "user:17:30d:default:10:8:8:8:30",
		},
		{
			name:   "custom window and limits",
			userID: 3,
			query: url.Values{
				"window":        {"90d"},
				"tracks_limit":  {"5"},
				"artists_limit": {"4"},
				"albums_limit":  {"3"},
				"genres_limit":  {"2"},
				"replay_limit":  {"9"},
			},
			want: "user:3:90d:default:5:4:3:2:9",
		},
		{
			name:   "month overrides period",
			userID: 9,
			query:  url.Values{"month": {"2026-04"}},
			want:   "user:9:month:2026-04:2026-04:10:8:8:8:30",
		},
		{
			name:    "invalid month",
			userID:  9,
			query:   url.Values{"month": {"April"}},
			wantErr: true,
		},
		{
			name:    "limit out of range",
			userID:  9,
			query:   url.Values{"tracks_limit": {"101"}},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := statsDashboardSubjectKey(tt.userID, tt.query)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
