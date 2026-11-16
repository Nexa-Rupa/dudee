#!/bin/sh
# Creates the workspace on first start (settings come from env vars), then runs dudee.
set -e

if [ ! -f "$DUDE_HOME/config.yaml" ]; then
  ARGS="init -y"
  [ -n "$DUDE_COMPANY" ] && ARGS="$ARGS --company \"$DUDE_COMPANY\""
  [ -n "$DUDE_MODEL" ] && ARGS="$ARGS --model \"$DUDE_MODEL\""
  eval "dudee $ARGS"
fi

exec dudee "$@"
