#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
expected_version="opencode2 v0.0.0-beta-18286"
actual_version=$(opencode2 --version)
if [[ "$actual_version" != "$expected_version" ]]; then
	printf 'Expected %s, found %s.\n' "$expected_version" "$actual_version" >&2
	exit 1
fi
real_home=${HOME:?HOME must be set}
real_data_home=${XDG_DATA_HOME:-"$real_home/.local/share"}
real_database="$real_data_home/opencode/opencode.db"
temp_parent=${TMPDIR:-/private/var/folders/00/kg4g6rwj56df8m493xpgm7s00000gn/T/opencode}
root=${OPENCODE_PROTOTYPE_ROOT:-$(mktemp -d "$temp_parent/codex-compaction.XXXXXX")}
home="$root/home"
config_dir="$home/.config/opencode"
data_dir="$root/data/opencode"
project_dir="$root/project"

mkdir -p "$config_dir" "$data_dir" "$project_dir" "$root/cache" "$root/state"
chmod 700 "$root" "$home" "$data_dir"

for credential in auth.json account.json; do
	if [[ -f "$real_data_home/opencode/$credential" && ! -e "$data_dir/$credential" ]]; then
		cp "$real_data_home/opencode/$credential" "$data_dir/$credential"
		chmod 600 "$data_dir/$credential"
	fi
done

python3 - "$config_dir/opencode.jsonc" "$script_dir/index.ts" <<'PY'
import json
import sys

config_path, plugin_path = sys.argv[1:]
config = {
    "warming": False,
    "compaction": {
        "auto": True,
        "keep": {"tokens": 0},
        "buffer": 20000,
    },
    "plugins": [{
        "package": plugin_path,
        "options": {
            "debug": True,
        },
    }],
}
with open(config_path, "w", encoding="utf-8") as file:
    json.dump(config, file, indent=2)
    file.write("\n")
PY

printf 'OpenCode Codex compaction prototype root: %s\n' "$root" >&2
printf 'Default OpenCode config is isolated. Remove this root when testing is complete.\n' >&2

export HOME="$home"
export XDG_CONFIG_HOME="$home/.config"
export XDG_DATA_HOME="$root/data"
export XDG_CACHE_HOME="$root/cache"
export XDG_STATE_HOME="$root/state"

cd "$project_dir"
if [[ ! -f "$data_dir/opencode.db" ]]; then
	opencode2 models --standalone >/dev/null
	if [[ -f "$real_database" ]]; then
		python3 - "$real_database" "$data_dir/opencode.db" <<'PY'
import sqlite3
import sys

source_path, destination_path = sys.argv[1:]
source = sqlite3.connect(source_path)
source.execute("PRAGMA query_only = ON")
destination = sqlite3.connect(destination_path)
try:
    columns = [row[1] for row in destination.execute("PRAGMA table_info(credential)")]
    if columns:
        names = ", ".join(f'"{column}"' for column in columns)
        placeholders = ", ".join("?" for _ in columns)
        rows = source.execute(f"SELECT {names} FROM credential").fetchall()
        destination.executemany(
            f"INSERT OR REPLACE INTO credential ({names}) VALUES ({placeholders})",
            rows,
        )
        destination.commit()
finally:
    destination.close()
    source.close()
PY
		chmod 600 "$data_dir/opencode.db"
	fi
fi

if (( $# == 0 )); then
	exec opencode2 --standalone "$project_dir"
fi
exec opencode2 "$@"
