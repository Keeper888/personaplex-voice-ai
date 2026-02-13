#!/bin/bash
set -e

if [ -z "${HF_TOKEN}" ]; then
    echo "ERROR: HF_TOKEN secret is required."
    echo "Add it in Space Settings > Repository Secrets"
    exit 1
fi

echo "Starting PersonaPlex moshi.server on port 8998..."

exec /app/moshi/.venv/bin/python -m moshi.server \
    --host 0.0.0.0 \
    --port 8998 \
    --static /app/static
