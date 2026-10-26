package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestParagraphIndentsEveryLineAndKeepsPathsWhole(t *testing.T) {
	text := "Start Crate with docker compose up -d in /tmp/crate-installer/run-1234/home whenever you are ready to listen."
	out := Paragraph(lipgloss.NewStyle(), text, 4)

	for _, line := range strings.Split(out, "\n") {
		if !strings.HasPrefix(line, "    ") {
			t.Errorf("line not indented: %q", line)
		}
		if strings.HasSuffix(line, " ") {
			t.Errorf("trailing space: %q", line)
		}
	}
	if !strings.Contains(out, "/tmp/crate-installer/run-1234/home") {
		t.Errorf("path was split:\n%s", out)
	}
}
