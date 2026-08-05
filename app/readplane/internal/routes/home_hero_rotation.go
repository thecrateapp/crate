package routes

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"time"
)

const homeHeroRotationVersion = "home_hero_rotation_v1"

func rotateHomeHeroPayload(payload map[string]any, userID int64, now time.Time) map[string]any {
	value, ok := payload["hero"]
	if !ok {
		return payload
	}

	rotated := rotateHomeHeroValue(value, userID, now)
	result := make(map[string]any, len(payload))
	for key, item := range payload {
		result[key] = item
	}
	result["hero"] = rotated
	return result
}

func rotateHomeHeroValue(value any, userID int64, now time.Time) any {
	rows, ok := value.([]any)
	if !ok {
		return value
	}
	return rotateHomeHeroRows(rows, userID, now)
}

func rotateHomeHeroRows(rows []any, userID int64, now time.Time) []any {
	if len(rows) <= 1 {
		return rows
	}

	candidateCount := min(len(rows), 5)
	weights := make([]float64, candidateCount)
	totalWeight := 0.0
	for index := 0; index < candidateCount; index++ {
		weight := 0.35 + (1.0 / math.Pow(float64(index+1), 0.65))
		weights[index] = weight
		totalWeight += weight
	}

	rotationDay := now.UTC().Format("2006-01-02")
	seed := fmt.Sprintf("%s:%d:%s", homeHeroRotationVersion, userID, rotationDay)
	digest := sha256.Sum256([]byte(seed))
	target := (float64(binary.BigEndian.Uint64(digest[:8])) / math.Pow(2, 64)) * totalWeight
	selectedIndex := 0
	for index, weight := range weights {
		if target < weight {
			selectedIndex = index
			break
		}
		target -= weight
	}

	rotated := make([]any, 0, len(rows))
	rotated = append(rotated, rows[selectedIndex])
	for index := 0; index < candidateCount; index++ {
		if index != selectedIndex {
			rotated = append(rotated, rows[index])
		}
	}
	rotated = append(rotated, rows[candidateCount:]...)
	return rotated
}
