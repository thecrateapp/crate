package catalog

import (
	"encoding/json"
	"os"
)

var (
	genreTopLevelMetadata map[string]map[string]string
	staticGenreTopLevel   map[string]string
)

type taxonomyData struct {
	TopLevelMetadata map[string]map[string]string `json:"top_level_metadata"`
	StaticTopLevel   map[string]string            `json:"static_top_level"`
}

var defaultTaxonomy = taxonomyData{
	TopLevelMetadata: map[string]map[string]string{
		"rock":        {"name": "rock", "description": "broad guitar-driven family spanning classic, hard and modern rock traditions."},
		"alternative": {"name": "alternative rock", "description": "umbrella for off-mainstream rock scenes with moodier, noisier or more experimental edges."},
		"metal":       {"name": "metal", "description": "heavy guitar-based family built around distortion, power riffs and high intensity."},
		"punk":        {"name": "punk", "description": "fast, direct and confrontational guitar music rooted in diy scenes."},
		"electronic":  {"name": "electronic", "description": "music driven primarily by synths, drum machines and electronic production."},
		"hip-hop":     {"name": "hip hop", "description": "rhythm-first music built from rapping, beats, sampling and dj culture."},
		"jazz":        {"name": "jazz", "description": "improvisation-heavy tradition centered on swing, harmony and instrumental interplay."},
		"blues":       {"name": "blues", "description": "roots-based music built on expressive vocal delivery, guitar and a 12-bar harmonic backbone."},
		"soul":        {"name": "soul", "description": "groove-led black popular music built around voice, rhythm sections and emotional delivery."},
		"folk":        {"name": "folk", "description": "song-led acoustic-rooted family tied to traditional and regional forms."},
		"country":     {"name": "country", "description": "song-driven tradition rooted in storytelling, acoustic and steel guitar, and rural americana sensibility."},
		"pop":         {"name": "pop", "description": "hook-forward mainstream songwriting built for immediacy and accessibility."},
		"classical":   {"name": "classical", "description": "composed western art music spanning orchestral, chamber, choral and solo instrumental traditions."},
		"ambient":     {"name": "ambient", "description": "atmospheric, texture-driven music focused more on mood than on beat."},
	},
	StaticTopLevel: map[string]string{
		"rock": "rock", "alternative": "alternative", "metal": "metal", "punk": "punk",
		"electronic": "electronic", "hip-hop": "hip-hop", "jazz": "jazz", "blues": "blues",
		"soul": "soul", "folk": "folk", "country": "country", "pop": "pop", "classical": "classical", "ambient": "ambient",
		"funk":       "soul",
		"indie-rock": "alternative", "post-punk": "alternative", "shoegaze": "alternative", "dream-pop": "alternative",
		"noise-rock": "alternative", "new-wave": "alternative", "gothic-rock": "alternative",
		"garage-rock": "rock", "psychedelic-rock": "rock", "stoner-rock": "rock", "grunge": "rock",
		"heavy-metal": "metal", "thrash-metal": "metal", "crossover-thrash": "metal", "death-metal": "metal",
		"black-metal": "metal", "doom-metal": "metal", "sludge-metal": "metal", "stoner-metal": "metal",
		"groove-metal": "metal", "speed-metal": "metal", "power-metal": "metal", "progressive-metal": "metal",
		"industrial-metal": "metal", "post-metal": "metal", "metalcore": "metal", "grindcore": "metal", "nu-metal": "metal",
		"hardcore-punk": "punk", "beatdown-hardcore": "punk", "powerviolence": "punk", "melodic-hardcore": "punk",
		"post-hardcore": "punk", "skate-punk": "punk", "pop-punk": "punk", "crust-punk": "punk",
		"d-beat": "punk", "anarcho-punk": "punk", "art-punk": "punk", "emo": "punk", "screamo": "punk", "noisecore": "punk",
		"industrial": "electronic", "synthpop": "electronic", "techno": "electronic", "house": "electronic", "trip-hop": "electronic",
	},
}

// LoadDefaultTaxonomy initializes taxonomy metadata from built-in defaults.
func LoadDefaultTaxonomy() {
	applyTaxonomy(defaultTaxonomy)
}

// LoadTaxonomy reads the genre taxonomy JSON file and initializes global lookup maps.
func LoadTaxonomy(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var t taxonomyData
	if err := json.Unmarshal(data, &t); err != nil {
		return err
	}
	applyTaxonomy(t)
	return nil
}

func applyTaxonomy(t taxonomyData) {
	genreTopLevelMetadata = t.TopLevelMetadata
	staticGenreTopLevel = t.StaticTopLevel
}
