#!/bin/bash
# Install Maddie's own Overpass as four systemd services, on aschkan.
#
# Run AFTER the import has finished (`/srv/overpass/setup.log` says IMPORT
# DONE). Needs root, for the unit files only; every service runs as `aschkan`.
#
#   sudo bash scripts/overpass/install.sh
#
# The services:
#   maddie-overpass-dispatcher   holds the database open; queries go through it
#   maddie-overpass-http         http.js — POST /api/interpreter on 127.0.0.1:12345
#   maddie-overpass-fetch        downloads Geofabrik's daily Netherlands diffs
#   maddie-overpass-apply        applies them to the database
#
# Every one is low priority (Nice=19, idle I/O): this box serves sixteen apps
# and MongoDB, and the map data being an hour late matters to nobody.
set -euo pipefail

OP=/srv/overpass
USER_NAME=aschkan
HERE="$(cd "$(dirname "$0")" && pwd)"
GEOFABRIK=https://download.geofabrik.de/europe/netherlands-updates

[ -f "$OP/db/replicate_state.txt" ] || { echo "No import yet: $OP/db/replicate_state.txt is missing."; exit 1; }
START_ID=$(sed -n 's/^sequenceNumber=//p' "$OP/db/replicate_state.txt")
[ -n "$START_ID" ] || { echo "Could not read the sequence number."; exit 1; }

install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$HERE/http.js" "$OP/http.js"
install -d -o "$USER_NAME" -g "$USER_NAME" "$OP/diffs"

common() {
  cat <<EOF
[Unit]
Description=$1
After=network-online.target srv-overpass.mount
Requires=srv-overpass.mount
$2

[Service]
User=$USER_NAME
Nice=19
IOSchedulingClass=idle
Restart=always
RestartSec=30
WorkingDirectory=$OP
$3

[Install]
WantedBy=multi-user.target
EOF
}

common "Maddie Overpass — dispatcher" "" \
  "ExecStartPre=-/bin/rm -f $OP/db/osm3s_osm_base $OP/db/osm3s_areas /dev/shm/osm3s_osm_base /dev/shm/osm3s_areas
ExecStart=$OP/bin/dispatcher --osm-base --db-dir=$OP/db/
ExecStop=$OP/bin/dispatcher --osm-base --terminate" \
  > /etc/systemd/system/maddie-overpass-dispatcher.service

common "Maddie Overpass — HTTP on 127.0.0.1:12345" \
  "After=maddie-overpass-dispatcher.service
Requires=maddie-overpass-dispatcher.service" \
  "ExecStart=/usr/bin/env node $OP/http.js" \
  > /etc/systemd/system/maddie-overpass-http.service

common "Maddie Overpass — fetch Geofabrik diffs" "" \
  "ExecStart=$OP/bin/fetch_osc.sh $START_ID $GEOFABRIK $OP/diffs" \
  > /etc/systemd/system/maddie-overpass-fetch.service

common "Maddie Overpass — apply diffs" \
  "After=maddie-overpass-dispatcher.service
Requires=maddie-overpass-dispatcher.service" \
  "ExecStart=$OP/bin/apply_osc_to_db.sh $OP/diffs $START_ID --meta=no" \
  > /etc/systemd/system/maddie-overpass-apply.service

systemctl daemon-reload
for unit in dispatcher http fetch apply; do
  systemctl enable --now "maddie-overpass-$unit.service"
done
sleep 3
systemctl --no-pager --lines=0 status maddie-overpass-{dispatcher,http,fetch,apply}.service | grep -E "●|Active"
