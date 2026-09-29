#!/usr/bin/env bash
# Lists published ports with `docker ps`, or reads that listing from the file given as the first argument, for tests.
# Fails on any published port except Caddy's public 80 and 443.
# Docker skips UFW for published ports, so this check is the firewall for containers.
set -euo pipefail
if [ $# -gt 0 ]; then listing=$(cat "$1"); else listing=$(docker ps --format '{{.Names}}\t{{.Ports}}'); fi
bad=0
while IFS=$'\t' read -r name ports; do
  [ -z "$ports" ] && continue
  IFS=',' read -ra mappings <<< "$ports"
  for mapping in "${mappings[@]}"; do
    mapping="${mapping# }"
    [[ "$mapping" != *"->"* ]] && continue
    if [ "$name" = "factory-caddy" ] && [[ "$mapping" =~ ^0\.0\.0\.0:(80|443)-\>(80|443)/tcp$ ]]; then continue; fi
    echo "Published port not allowed: $name $mapping"
    bad=1
  done
done <<< "$listing"
exit "$bad"
