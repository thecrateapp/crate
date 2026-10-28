package ui

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/reflow/wordwrap"
	"golang.org/x/term"
)

const maxWidth = 78

// Width is the frame width: the terminal width capped for readability.
func Width() int {
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 20 {
		return min(w-2, maxWidth)
	}
	return maxWidth
}

func Banner(w io.Writer, version string) {
	mark := lipgloss.NewStyle().Foreground(accentHi).Bold(true).Render("crate")
	fmt.Fprintf(w, "\n  %s  %s\n", mark, Muted.Render("installer "+version))
	fmt.Fprintf(w, "  %s\n\n", Muted.Render("Self-hosted music, set up step by step."))
}

// Paragraph wraps text to the frame and indents every line.
func Paragraph(style lipgloss.Style, text string, indent int) string {
	pad := strings.Repeat(" ", indent)
	wrapper := wordwrap.NewWriter(Width() - indent)
	wrapper.Breakpoints = nil // never split paths and URLs at hyphens
	wrapper.Write([]byte(text))
	wrapper.Close()
	lines := strings.Split(wrapper.String(), "\n")
	for i, line := range lines {
		lines[i] = pad + style.Render(line)
	}
	return strings.Join(lines, "\n")
}

// Step prints the frame of one wizard step.
func Step(w io.Writer, number, total int, title, description string) {
	width := Width()
	counter := Muted.Render(fmt.Sprintf("STEP %d OF %d", number, total))
	fmt.Fprintf(w, "\n  %s\n  %s\n  %s\n", counter, Rule.Render(strings.Repeat("─", width-2)), Title.Render(title))
	if description != "" {
		fmt.Fprintln(w, Paragraph(Muted, description, 2))
	}
	fmt.Fprintln(w)
}

type Tone int

const (
	ToneOK Tone = iota
	ToneWarn
	ToneFail
	ToneInfo
)

func dot(tone Tone) string {
	switch tone {
	case ToneOK:
		return lipgloss.NewStyle().Foreground(success).Render("●")
	case ToneWarn:
		return lipgloss.NewStyle().Foreground(warning).Render("●")
	case ToneFail:
		return lipgloss.NewStyle().Foreground(danger).Render("●")
	}
	return lipgloss.NewStyle().Foreground(accentHi).Render("●")
}

// StatusRow prints "● Title  detail" with an optional indented hint.
func StatusRow(w io.Writer, tone Tone, title, detail, hint string) {
	fmt.Fprintf(w, "  %s %s  %s\n", dot(tone), Value.Width(14).Render(title), Muted.Render(detail))
	if hint != "" {
		fmt.Fprintln(w, Paragraph(Muted, hint, 4))
	}
}

// Rows prints aligned label/value pairs.
func Rows(w io.Writer, rows [][2]string) {
	labelWidth := 0
	for _, row := range rows {
		labelWidth = max(labelWidth, lipgloss.Width(row[0]))
	}
	for _, row := range rows {
		fmt.Fprintf(w, "  %s  %s\n", Label.Width(labelWidth).Render(row[0]), Value.Render(row[1]))
	}
}

func Heading(w io.Writer, text string) {
	fmt.Fprintf(w, "\n  %s\n", Muted.Render(strings.ToUpper(text)))
}

func Success(w io.Writer, text string) { note(w, ToneOK, text) }

func Warning(w io.Writer, text string) { note(w, ToneWarn, text) }

func Failure(w io.Writer, text string) { note(w, ToneFail, text) }

func note(w io.Writer, tone Tone, text string) {
	body := strings.TrimLeft(Paragraph(Value, text, 4), " ")
	fmt.Fprintf(w, "  %s %s\n", dot(tone), body)
}

func IsTerminal(f *os.File) bool {
	return term.IsTerminal(int(f.Fd()))
}
