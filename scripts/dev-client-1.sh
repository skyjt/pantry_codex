#!/usr/bin/env sh
set -eu

# 本机三客户端联调：客户端 1 使用默认端口，数据目录独立于真实用户数据。
SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "用法：npm run dev:client1"
  echo "客户端 1：/tmp/pantry-dev1，UDP 17878，TCP 17879，手动指向客户端 2/3。"
  exit 0
fi

export PANTRY_USER_DATA="${PANTRY_USER_DATA:-/tmp/pantry-dev1}"
export PANTRY_UDP_PORT="${PANTRY_UDP_PORT:-17878}"
export PANTRY_TCP_PORT="${PANTRY_TCP_PORT:-17879}"
export PANTRY_PEERS="${PANTRY_PEERS:-127.0.0.1:27878,127.0.0.1:37878}"

echo "启动茶话间客户端 1：userData=$PANTRY_USER_DATA UDP=$PANTRY_UDP_PORT TCP=$PANTRY_TCP_PORT peers=$PANTRY_PEERS"
exec npm run dev
