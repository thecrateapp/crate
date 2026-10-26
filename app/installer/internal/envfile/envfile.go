// Package envfile reads and writes the docker compose .env file.
//
// Values are written in double quotes with backslash, quote, dollar and
// backtick escaped, so compose never interpolates them.
package envfile

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"
)

// Values preserves the order in which keys were first seen.
type Values struct {
	keys   []string
	values map[string]string
}

func New() *Values {
	return &Values{values: map[string]string{}}
}

func (v *Values) Get(key string) (string, bool) {
	value, ok := v.values[key]
	return value, ok
}

func (v *Values) Set(key, value string) {
	if _, ok := v.values[key]; !ok {
		v.keys = append(v.keys, key)
	}
	v.values[key] = value
}

func (v *Values) Keys() []string {
	return append([]string(nil), v.keys...)
}

func Read(path string) (*Values, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return Parse(file)
}

func Parse(r io.Reader) (*Values, error) {
	values := New()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		text = strings.TrimPrefix(text, "export ")
		key, raw, ok := strings.Cut(text, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: expected KEY=value", line)
		}
		value, err := unquote(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		values.Set(strings.TrimSpace(key), value)
	}
	return values, scanner.Err()
}

func unquote(raw string) (string, error) {
	if len(raw) >= 2 && raw[0] == '\'' && raw[len(raw)-1] == '\'' {
		return raw[1 : len(raw)-1], nil
	}
	if len(raw) == 0 || raw[0] != '"' {
		if index := strings.Index(raw, " #"); index >= 0 {
			raw = raw[:index]
		}
		return strings.TrimSpace(raw), nil
	}
	if len(raw) < 2 || raw[len(raw)-1] != '"' {
		return "", fmt.Errorf("unterminated quoted value")
	}
	var b strings.Builder
	inner := raw[1 : len(raw)-1]
	for i := 0; i < len(inner); i++ {
		if inner[i] == '\\' && i+1 < len(inner) {
			i++
			switch inner[i] {
			case 'n':
				b.WriteByte('\n')
			default:
				b.WriteByte(inner[i])
			}
			continue
		}
		b.WriteByte(inner[i])
	}
	return b.String(), nil
}

// Quote returns value as a double-quoted .env literal.
func Quote(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`, `$`, `\$`, "`", "\\`", "\n", `\n`)
	return `"` + replacer.Replace(value) + `"`
}

// Section is a commented block of keys in the written file.
type Section struct {
	Title string
	Keys  []string
}

// Render writes sections in order; keys present in values but in no section
// are kept in a final block so user additions survive a reconfigure.
func Render(values *Values, header string, sections []Section) string {
	var b strings.Builder
	written := map[string]bool{}
	b.WriteString(header)
	writeBlock := func(title string, keys []string) {
		var lines []string
		for _, key := range keys {
			if written[key] {
				continue
			}
			value, ok := values.Get(key)
			if !ok {
				continue
			}
			written[key] = true
			lines = append(lines, key+"="+Quote(value))
		}
		if len(lines) == 0 {
			return
		}
		b.WriteString("\n# " + title + "\n")
		b.WriteString(strings.Join(lines, "\n"))
		b.WriteString("\n")
	}
	for _, section := range sections {
		writeBlock(section.Title, section.Keys)
	}
	writeBlock("Other settings", values.Keys())
	return b.String()
}

// Write replaces path atomically with owner-only permissions.
func Write(path, content string) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
