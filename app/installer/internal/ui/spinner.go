package ui

import (
	"fmt"
	"io"
	"time"
)

var frames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// Spin shows label with a spinner while work runs. Without a terminal it
// prints the label once.
func Spin(w io.Writer, interactive bool, label string, work func() error) error {
	if !interactive {
		fmt.Fprintf(w, "  %s …\n", label)
		return work()
	}
	done := make(chan error, 1)
	go func() { done <- work() }()
	started := time.Now()
	ticker := time.NewTicker(90 * time.Millisecond)
	defer ticker.Stop()
	for frame := 0; ; frame++ {
		select {
		case err := <-done:
			fmt.Fprint(w, "\r\033[K")
			return err
		case <-ticker.C:
			elapsed := time.Since(started).Round(time.Second)
			fmt.Fprintf(w, "\r\033[K  %s %s %s", Accent.Render(frames[frame%len(frames)]), Value.Render(label), Muted.Render(elapsed.String()))
		}
	}
}
