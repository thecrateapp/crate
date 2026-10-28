// Package ui holds the installer's look: Crate's colours, the step frame,
// status rows and the huh form theme.
package ui

import (
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// Crate V3 tokens (app/shared/ui/tokens/themes.css).
var (
	accent   = lipgloss.Color("#06b6d4")
	accentHi = lipgloss.Color("#67e8f9")
	text     = lipgloss.AdaptiveColor{Light: "#0f172a", Dark: "#f1f5f9"}
	muted    = lipgloss.AdaptiveColor{Light: "#64748b", Dark: "#999ca0"}
	faint    = lipgloss.AdaptiveColor{Light: "#cbd5e1", Dark: "#3f4248"}
	success  = lipgloss.Color("#22c55e")
	warning  = lipgloss.Color("#fbbf24")
	danger   = lipgloss.Color("#ef4444")
	onAccent = lipgloss.Color("#0a0a0f")
)

var (
	Title  = lipgloss.NewStyle().Foreground(text).Bold(true)
	Muted  = lipgloss.NewStyle().Foreground(muted)
	Accent = lipgloss.NewStyle().Foreground(accentHi)
	Label  = lipgloss.NewStyle().Foreground(muted)
	Value  = lipgloss.NewStyle().Foreground(text)
	Link   = lipgloss.NewStyle().Foreground(accentHi).Underline(true)
	Rule   = lipgloss.NewStyle().Foreground(faint)
)

// Theme is huh's base theme in Crate colours.
func Theme() *huh.Theme {
	t := huh.ThemeBase()
	t.Focused.Base = t.Focused.Base.BorderForeground(accent)
	t.Focused.Card = t.Focused.Base
	t.Focused.Title = t.Focused.Title.Foreground(accentHi).Bold(true)
	t.Focused.NoteTitle = t.Focused.NoteTitle.Foreground(accentHi).Bold(true).MarginBottom(1)
	t.Focused.Description = t.Focused.Description.Foreground(muted)
	t.Focused.ErrorIndicator = t.Focused.ErrorIndicator.Foreground(danger)
	t.Focused.ErrorMessage = t.Focused.ErrorMessage.Foreground(danger)
	t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(accentHi)
	t.Focused.NextIndicator = t.Focused.NextIndicator.Foreground(accentHi)
	t.Focused.PrevIndicator = t.Focused.PrevIndicator.Foreground(accentHi)
	t.Focused.Option = t.Focused.Option.Foreground(text)
	t.Focused.MultiSelectSelector = t.Focused.MultiSelectSelector.Foreground(accentHi)
	t.Focused.SelectedOption = t.Focused.SelectedOption.Foreground(accentHi)
	t.Focused.SelectedPrefix = lipgloss.NewStyle().Foreground(accentHi).SetString("● ")
	t.Focused.UnselectedPrefix = lipgloss.NewStyle().Foreground(muted).SetString("○ ")
	t.Focused.UnselectedOption = t.Focused.UnselectedOption.Foreground(text)
	t.Focused.FocusedButton = t.Focused.FocusedButton.Foreground(onAccent).Background(accent).Bold(true)
	t.Focused.Next = t.Focused.FocusedButton
	t.Focused.BlurredButton = t.Focused.BlurredButton.Foreground(muted).Background(lipgloss.AdaptiveColor{Light: "#e2e8f0", Dark: "#1f2227"})
	t.Focused.TextInput.Cursor = t.Focused.TextInput.Cursor.Foreground(accentHi)
	t.Focused.TextInput.Placeholder = t.Focused.TextInput.Placeholder.Foreground(muted)
	t.Focused.TextInput.Prompt = t.Focused.TextInput.Prompt.Foreground(accent)

	t.Blurred = t.Focused
	t.Blurred.Base = t.Focused.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Blurred.Card = t.Blurred.Base
	t.Blurred.Title = t.Blurred.Title.Foreground(muted).Bold(false)
	t.Blurred.NextIndicator = lipgloss.NewStyle()
	t.Blurred.PrevIndicator = lipgloss.NewStyle()

	t.Group.Title = t.Focused.Title
	t.Group.Description = t.Focused.Description
	return t
}
