Output "out/install.webm"
Output "out/install.mp4"
Output "out/install.ascii"
Set Shell "bash"
Set FontSize 16
Set Width 1400
Set Height 1180
Set Padding 36
Set TypingSpeed 55ms
Set Theme { "name": "crate", "black": "#0a0a0f", "red": "#f87171", "green": "#34d399", "yellow": "#fbbf24", "blue": "#38bdf8", "magenta": "#c084fc", "cyan": "#22d3ee", "white": "#f1f5f9", "brightBlack": "#64748b", "brightRed": "#fca5a5", "brightGreen": "#6ee7b7", "brightYellow": "#fcd34d", "brightBlue": "#7dd3fc", "brightMagenta": "#d8b4fe", "brightCyan": "#67e8f9", "brightWhite": "#ffffff", "background": "#0a0a0f", "foreground": "#e2e8f0", "selection": "#1e293b", "cursor": "#22d3ee" }
Env PATH "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Hide
Type `docker run --rm -it --name crate-tape-demo --hostname homeserver -e TZ=Europe/Madrid -e TERM=xterm-256color -e COLORTERM=truecolor --tmpfs /home:size=480g,mode=755 -v $PWD/bin/crate:/opt/crate/crate:ro -v $PWD/wrap.sh:/opt/crate/wrap.sh:ro debian:bookworm-slim bash -c "useradd -m -s /bin/bash you && exec su you -s /bin/bash -c 'cd ~ && export PS1=\"you@homeserver:~\$ \" && exec bash --norc'"`
Enter
Sleep 3s
Type "alias crate=/opt/crate/wrap.sh && clear"
Enter
Sleep 1s
Show
Sleep 800ms
Type "crate install"
Sleep 400ms
Enter
Wait+Screen@20s /Install folder/
Sleep 1.5s
Screenshot "out/01-checks.png"
Enter
Wait+Screen@20s /Music library/
Sleep 1.2s
Enter
Sleep 900ms
Enter
Sleep 900ms
Enter
Wait+Screen@10s /enter submit/
Sleep 900ms
Screenshot "out/02-paths.png"
Enter
Wait+Screen@20s /Access/
Sleep 800ms
Down
Sleep 400ms
Down
Sleep 400ms
Down
Sleep 1s
Screenshot "out/03-access.png"
Up
Sleep 250ms
Up
Sleep 250ms
Up
Sleep 500ms
Enter
Wait+Screen@20s /default ports/
Sleep 800ms
Enter
Wait+Screen@20s /What do you want to set up now/
Sleep 800ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 1s
Screenshot "out/04-integrations.png"
Up 10
Sleep 400ms
Type "x"
Sleep 250ms
Down
Type "x"
Sleep 600ms
Enter
Wait+Screen@20s /STEP 5 OF 7/
Sleep 800ms
Screenshot "out/05-account.png"
Enter
Sleep 700ms
Enter
Wait+Screen@20s /STEP 6 OF 7/
Sleep 1.5s
Screenshot "out/06-review.png"
Enter
Sleep 4s
Screenshot "out/07-install.png"
Sleep 2s
Ctrl+C
Sleep 1s
Hide
Type "exit"
Enter
