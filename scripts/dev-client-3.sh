#!/usr/bin/env sh
set -eu

# 本机三客户端联调：客户端 3 错开 UDP/TCP 端口，并指向另外两个客户端。
SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "用法：npm run dev:client3"
  echo "客户端 3：/tmp/pantry-dev3，UDP 37878，TCP 37879，手动指向客户端 1/2。"
  exit 0
fi

export PANTRY_USER_DATA="${PANTRY_USER_DATA:-/tmp/pantry-dev3}"
export PANTRY_UDP_PORT="${PANTRY_UDP_PORT:-37878}"
export PANTRY_TCP_PORT="${PANTRY_TCP_PORT:-37879}"
export PANTRY_PEERS="${PANTRY_PEERS:-127.0.0.1:17878,127.0.0.1:27878}"

echo "启动茶话间客户端 3：userData=$PANTRY_USER_DATA UDP=$PANTRY_UDP_PORT TCP=$PANTRY_TCP_PORT peers=$PANTRY_PEERS"
exec npm run dev
