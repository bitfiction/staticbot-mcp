#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  staticbot-api.sh spec
  staticbot-api.sh METHOD PATH [BODY_FILE|-]

Examples:
  staticbot-api.sh GET /templates
  staticbot-api.sh GET '/deployments?stackId=...'
  staticbot-api.sh POST /migrations request.json
  staticbot-api.sh POST /migrations/.../confirm

Environment:
  STATICBOT_API_KEY  Required for API requests; never passed as an argument.
  STATICBOT_API_URL  Optional origin, defaults to https://app.staticbot.dev.
EOF
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  usage
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  printf 'Error: curl is required.\n' >&2
  exit 127
fi

api_origin=${STATICBOT_API_URL:-https://app.staticbot.dev}
api_origin=${api_origin%/}

if [[ ! $api_origin =~ ^https?://[^/]+$ ]]; then
  printf 'Error: STATICBOT_API_URL must be an http(s) origin without a path.\n' >&2
  exit 64
fi

if [[ ${1:-} == "spec" ]]; then
  if (( $# != 1 )); then
    usage >&2
    exit 64
  fi
  exec curl --fail-with-body --silent --show-error \
    --header 'Accept: application/json' \
    "${api_origin}/v3/api-docs/v1"
fi

if (( $# < 2 || $# > 3 )); then
  usage >&2
  exit 64
fi

request_path=$2
body_source=${3:-}

case $1 in
  GET|Get|get) method=GET ;;
  POST|Post|post) method=POST ;;
  PUT|Put|put) method=PUT ;;
  PATCH|Patch|patch) method=PATCH ;;
  DELETE|Delete|delete) method=DELETE ;;
  *)
    printf 'Error: unsupported HTTP method: %s\n' "$1" >&2
    exit 64
    ;;
esac

if [[ -z ${STATICBOT_API_KEY:-} ]]; then
  printf 'Error: STATICBOT_API_KEY is required. Open API in the Staticbot menu (https://app.staticbot.dev/developer), create one in the API Keys section, and export it in your shell.\n' >&2
  exit 78
fi

# Pass the bearer header through a restrictive temporary curl config instead of
# exposing the key in curl's process arguments. Do not pass the exported key on
# to curl's environment either.
auth_config=$(mktemp "${TMPDIR:-/tmp}/staticbot-curl.XXXXXX")
chmod 600 "$auth_config"
cleanup() {
  rm -f "$auth_config"
}
trap cleanup EXIT HUP INT TERM
printf 'header = "Authorization: Bearer %s"\n' "$STATICBOT_API_KEY" > "$auth_config"
unset STATICBOT_API_KEY

if [[ $request_path == *://* || $request_path != /* ]]; then
  printf 'Error: PATH must be a relative path beginning with /. Absolute URLs are refused.\n' >&2
  exit 64
fi

if [[ $request_path == /api/v1 || $request_path == /api/v1/* ]]; then
  normalized_path=$request_path
else
  normalized_path="/api/v1${request_path}"
fi

curl_args=(
  --fail-with-body
  --silent
  --show-error
  --request "$method"
  --config "$auth_config"
  --header 'Accept: application/json'
)

if [[ -n $body_source ]]; then
  if [[ $method == GET || $method == DELETE ]]; then
    printf 'Error: a request body is not allowed for %s by this helper.\n' "$method" >&2
    exit 64
  fi
  if [[ $body_source != - && ! -f $body_source ]]; then
    printf 'Error: body file not found: %s\n' "$body_source" >&2
    exit 66
  fi
  curl_args+=(--header 'Content-Type: application/json' --data-binary "@${body_source}")
fi

curl "${curl_args[@]}" "${api_origin}${normalized_path}"
