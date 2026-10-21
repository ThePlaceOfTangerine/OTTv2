#!/bin/sh
# Starts the grader agent inside the ott-grader distro with the bwrap sandbox.
set -eu
set -a; . /etc/ott-grader.env; set +a
export SANDBOX_BACKEND=bwrap GRADER_WORKDIR="${GRADER_WORKDIR:-$HOME/work}"
cd /opt/ott
exec node scripts/grader.js
