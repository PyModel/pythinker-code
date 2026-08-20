#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${PACKAGE_DIR}/../.." && pwd)"

workspace_slug="$(
  basename -- "${REPO_ROOT}" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9_.-' '-' \
    | sed -e 's/^[^a-z0-9]*//' -e 's/[^a-z0-9]*$//' \
    | cut -c1-48
)"
if [[ -z "${workspace_slug}" ]]; then
  workspace_slug="workspace"
fi
workspace_hash="$(printf '%s' "${REPO_ROOT}" | cksum | awk '{print $1}')"
RUN_ID="${PYTHINKER_SERVER_E2E_RUN_ID:-${workspace_slug}-${workspace_hash}}"

BASE_IMAGE="${PYTHINKER_SERVER_E2E_BASE_IMAGE:-pythinker-server-e2e-base:${RUN_ID}}"
IMAGE="${PYTHINKER_SERVER_E2E_IMAGE:-pythinker-server-e2e:${RUN_ID}}"
CONTAINER="${PYTHINKER_SERVER_E2E_CONTAINER:-pythinker-server-e2e-${RUN_ID}}"
STATE_ROOT="${PYTHINKER_SERVER_E2E_STATE_ROOT:-${HOME}/.pythinker-code-server-dev}"
PORT="${PYTHINKER_SERVER_E2E_PORT:-58627}"

PYTHINKER_HOME_HOST="${PYTHINKER_SERVER_E2E_PYTHINKER_HOME_HOST:-${STATE_ROOT}/docker-e2e/${RUN_ID}/pythinker-code-home}"
PYTHINKER_HOME_CONTAINER="/data/docker-e2e/pythinker-code-home"
SEED_HOME_HOST="${PYTHINKER_SERVER_E2E_SEED_PYTHINKER_HOME_HOST:-${STATE_ROOT}/pythinker-home/pythinker-code-home}"

if [[ -n "${PYTHINKER_SERVER_E2E_REPORT_DIR_HOST:-}" ]]; then
  REPORT_DIR_HOST="${PYTHINKER_SERVER_E2E_REPORT_DIR_HOST}"
  REPORT_ROOT_HOST="$(dirname -- "${REPORT_DIR_HOST}")"
  REPORT_DIR_NAME="$(basename -- "${REPORT_DIR_HOST}")"
else
  REPORT_ROOT_HOST="${PYTHINKER_SERVER_E2E_REPORT_ROOT_HOST:-${STATE_ROOT}/server-e2e-reports/docker/${RUN_ID}}"
  REPORT_DIR_NAME="latest"
  REPORT_DIR_HOST="${REPORT_ROOT_HOST}/${REPORT_DIR_NAME}"
fi
REPORT_ROOT_CONTAINER="/data/server-e2e-reports/docker"
REPORT_DIR_CONTAINER="${REPORT_ROOT_CONTAINER}/${REPORT_DIR_NAME}"
TMPDIR_CONTAINER="/data/docker-e2e/tmp"

NM_ROOT="${STATE_ROOT}/docker-e2e/${RUN_ID}/nm"

workspace_node_modules=(
  "root:/workspace/pythinker-code/node_modules"
  "apps_pythinker-code:/workspace/pythinker-code/apps/pythinker-code/node_modules"
  "apps_pythinker-web:/workspace/pythinker-code/apps/pythinker-web/node_modules"
  "apps_vis:/workspace/pythinker-code/apps/vis/node_modules"
  "apps_vis_server:/workspace/pythinker-code/apps/vis/server/node_modules"
  "apps_vis_web:/workspace/pythinker-code/apps/vis/web/node_modules"
  "docs:/workspace/pythinker-code/docs/node_modules"
  "pkg_acp-adapter:/workspace/pythinker-code/packages/acp-adapter/node_modules"
  "pkg_agent-core:/workspace/pythinker-code/packages/agent-core/node_modules"
  "pkg_agent-gateway:/workspace/pythinker-code/packages/agent-gateway/node_modules"
  "pkg_server-e2e:/workspace/pythinker-code/packages/klient/node_modules"
  "pkg_pyaos:/workspace/pythinker-code/packages/pyaos/node_modules"
  "pkg_kosong:/workspace/pythinker-code/packages/kosong/node_modules"
  "pkg_node-sdk:/workspace/pythinker-code/packages/node-sdk/node_modules"
  "pkg_oauth:/workspace/pythinker-code/packages/oauth/node_modules"
  "pkg_protocol:/workspace/pythinker-code/packages/protocol/node_modules"
  "pkg_services:/workspace/pythinker-code/packages/services/node_modules"
  "pkg_telemetry:/workspace/pythinker-code/packages/telemetry/node_modules"
)

mkdir -p "${STATE_ROOT}" "${PYTHINKER_HOME_HOST}" "${REPORT_DIR_HOST}" "${NM_ROOT}"
for mount in "${workspace_node_modules[@]}"; do
  mkdir -p "${NM_ROOT}/${mount%%:*}"
done

# Seed only auth/config into the isolated docker-e2e home. Never copy server
# locks, sessions, uploaded files, or reports from the compose server home.
if [[ -f "${SEED_HOME_HOST}/config.toml" && ! -f "${PYTHINKER_HOME_HOST}/config.toml" ]]; then
  cp "${SEED_HOME_HOST}/config.toml" "${PYTHINKER_HOME_HOST}/config.toml"
fi
if [[ -d "${SEED_HOME_HOST}/credentials" && ! -d "${PYTHINKER_HOME_HOST}/credentials" ]]; then
  cp -R "${SEED_HOME_HOST}/credentials" "${PYTHINKER_HOME_HOST}/credentials"
fi

if [[ "${PYTHINKER_SERVER_E2E_SKIP_BUILD:-0}" != "1" ]]; then
  docker build -t "${BASE_IMAGE}" -f "${REPO_ROOT}/Dockerfile" "${REPO_ROOT}"
  docker build \
    -t "${IMAGE}" \
    -f "${PACKAGE_DIR}/Dockerfile" \
    --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
    "${REPO_ROOT}"
fi

docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true

read -r -d '' container_script <<'EOS' || true
set -euo pipefail

cd /workspace/pythinker-code
mkdir -p "${PYTHINKER_CODE_HOME}/server" "${PYTHINKER_SERVER_E2E_REPORT_DIR}" "${TMPDIR}" /data/server-e2e-reports/docker
rm -f "${PYTHINKER_CODE_HOME}/server/lock"

if [[ ! -e /workspace/pythinker-code/node_modules/.modules.yaml || ! -e /workspace/pythinker-code/packages/klient/node_modules/ws ]]; then
  echo "[server-e2e:docker] installing pnpm deps"
  pnpm install --frozen-lockfile
else
  echo "[server-e2e:docker] pnpm deps already present"
fi

server_log="/data/server-e2e-reports/docker/server.log"
: > "${server_log}"

echo "[server-e2e:docker] starting server on container-local ${PYTHINKER_SERVER_URL}"
pnpm dev:server -- \
  --host 127.0.0.1 \
  --port "${PYTHINKER_SERVER_E2E_PORT}" \
  --log-level debug \
  --debug-endpoints \
  >"${server_log}" 2>&1 &
server_pid=$!

cleanup() {
  status=$?
  if kill -0 "${server_pid}" >/dev/null 2>&1; then
    kill "${server_pid}" >/dev/null 2>&1 || true
    wait "${server_pid}" >/dev/null 2>&1 || true
  fi
  exit "${status}"
}
trap cleanup EXIT INT TERM

ready=0
for attempt in $(seq 1 90); do
  if curl -fsS "${PYTHINKER_SERVER_URL}/api/v1/meta" >/tmp/server-meta.json 2>/tmp/server-curl.err; then
    ready=1
    echo "[server-e2e:docker] server ready: $(cat /tmp/server-meta.json)"
    break
  fi
  if ! kill -0 "${server_pid}" >/dev/null 2>&1; then
    echo "[server-e2e:docker] server exited before readiness" >&2
    tail -n 200 "${server_log}" >&2 || true
    exit 1
  fi
  sleep 1
done

if [[ "${ready}" != "1" ]]; then
  echo "[server-e2e:docker] server did not become ready within 90s" >&2
  cat /tmp/server-curl.err >&2 || true
  tail -n 200 "${server_log}" >&2 || true
  exit 1
fi

cd /workspace/pythinker-code/packages/klient
pnpm test
EOS

docker_args=(
  run
  --rm
  --init
  --name "${CONTAINER}"
  --workdir /workspace/pythinker-code/packages/klient
  --env "PYTHINKER_CODE_HOME=${PYTHINKER_HOME_CONTAINER}"
  --env "PYTHINKER_SERVER_E2E_PORT=${PORT}"
  --env "PYTHINKER_SERVER_URL=http://127.0.0.1:${PORT}"
  --env "PYTHINKER_SERVER_E2E_REPORT_DIR=${REPORT_DIR_CONTAINER}"
  --env "TMPDIR=${TMPDIR_CONTAINER}"
  --env "TERM=xterm-256color"
  --env "TZ=Asia/Shanghai"
  --env "npm_config_store_dir=/workspace/pythinker-code/node_modules/.pnpm-store"
  --env "npm_config_package_import_method=copy"
  --volume "${REPO_ROOT}:/workspace/pythinker-code:ro"
  --volume "${PYTHINKER_HOME_HOST}:${PYTHINKER_HOME_CONTAINER}"
  --volume "${REPORT_ROOT_HOST}:${REPORT_ROOT_CONTAINER}"
)

for mount in "${workspace_node_modules[@]}"; do
  docker_args+=(--volume "${NM_ROOT}/${mount%%:*}:${mount#*:}")
done

echo "[server-e2e:docker] running ${IMAGE} without host port publishing"
set +e
docker "${docker_args[@]}" "${IMAGE}" bash -lc "${container_script}"
status=$?
set -e

echo "[server-e2e:docker] report: ${REPORT_DIR_HOST}/index.html"
echo "[server-e2e:docker] server log: ${REPORT_ROOT_HOST}/server.log"
exit "${status}"
