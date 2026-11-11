#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--no-open") ]]; then
  printf '用法：npm run preview:ssh [-- --no-open]\n' >&2
  exit 2
fi

preview_host=wsl-yingzi
preview_port=31861
preview_origin="http://127.0.0.1:$preview_port"
preview_url="$preview_origin/workspace"
preview_socket="$HOME/.ssh/opengridworks-preview-$preview_port.sock"

if ! ssh -S "$preview_socket" -O check "$preview_host" >/dev/null 2>&1; then
  ssh -fNT -M -S "$preview_socket" \
    -o BatchMode=yes -o IdentitiesOnly=yes -o PreferredAuthentications=publickey \
    -o ConnectTimeout=15 -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -L "127.0.0.1:$preview_port:127.0.0.1:$preview_port" "$preview_host"
fi

if ! curl -fsS --noproxy 127.0.0.1 --max-time 12 "$preview_origin/api/database/health" >/dev/null; then
  printf 'SSH 隧道已建立，服务器上的 OpenGridWorks 预览或数据库暂不可用。\n' >&2
  exit 1
fi

printf '%s\n' "$preview_url"
if [[ ${1:-} != "--no-open" ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$preview_url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$preview_url"
  fi
fi
