package monitoring

import (
	"fmt"
	"io"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/ui"
)

// PrintEnabled shows how to open Grafana. A generated password is shown
// once, here.
func PrintEnabled(w io.Writer, result Enabled) {
	ui.Heading(w, "Open Grafana")
	password := "unchanged"
	switch {
	case result.Generated:
		password = result.Password
	case result.Password != "":
		password = "the one you chose"
	}
	ui.Rows(w, [][2]string{{"Address", result.URL}, {"User", GrafanaUser}, {"Password", password}})
	if result.Generated {
		fmt.Fprintf(w, "  %s\n", ui.Muted.Render("Save it now; it is not shown again."))
	}
	port := strings.TrimPrefix(result.URL, "http://localhost:")
	fmt.Fprintf(w, "  %s\n", ui.Muted.Render("Grafana listens only on this machine. From another computer: ssh -N -L "+port+":127.0.0.1:"+port+" <user>@<this server>"))
}
