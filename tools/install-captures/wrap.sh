#!/bin/sh
if [ "$1" = "install" ]; then shift; exec /opt/crate/crate install --dry-run "$@"; fi
exec /opt/crate/crate "$@"
