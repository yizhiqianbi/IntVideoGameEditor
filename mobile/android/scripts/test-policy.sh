#!/bin/sh
set -eu
project_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_output=$(mktemp -d)
trap 'rm -rf "$test_output"' EXIT HUP INT TERM
javac -encoding UTF-8 -d "$test_output" \
  "$project_root/app/src/main/java/top/xumeng/app/NavigationPolicy.java" \
  "$project_root/tests/NavigationPolicyTest.java"
java -cp "$test_output" top.xumeng.app.NavigationPolicyTest
