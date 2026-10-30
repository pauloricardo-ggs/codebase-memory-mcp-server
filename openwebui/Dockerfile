ARG OPENWEBUI_COMMIT=f7ac7ee10962ddec0017f5c29b6740d9b9c5faca

FROM node:22-alpine3.20 AS citation-frontend
ARG OPENWEBUI_COMMIT
WORKDIR /src
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apk add --no-cache git \
    && wget -qO /tmp/openwebui.tar.gz "https://codeload.github.com/open-webui/open-webui/tar.gz/${OPENWEBUI_COMMIT}" \
    && tar -xzf /tmp/openwebui.tar.gz --strip-components=1 -C /src \
    && rm /tmp/openwebui.tar.gz
RUN npm ci --force
COPY patch-openwebui-citations.mjs /tmp/patch-openwebui-citations.mjs
RUN node /tmp/patch-openwebui-citations.mjs /src/src/lib/components/chat/Messages/Citations.svelte \
    && npm run build

FROM ghcr.io/open-webui/open-webui:v0.12.5-cuda

COPY patch-google-drive-runtime.py /tmp/patch-google-drive-runtime.py
COPY patch-google-drive-citations.py /tmp/patch-google-drive-citations.py
COPY patch-knowledge-fs.py /tmp/patch-knowledge-fs.py
COPY patch-model-visibility.py /tmp/patch-model-visibility.py
COPY patch-whisper-prompt.py /tmp/patch-whisper-prompt.py
COPY patch-turn-notices.py /tmp/patch-turn-notices.py
COPY patch-datadog-prefetch.py /tmp/patch-datadog-prefetch.py
COPY patch-qwen-tool-calls.py /tmp/patch-qwen-tool-calls.py
COPY test-knowledge-fs-patch.py /tmp/test-knowledge-fs-patch.py
COPY google_drive_citations.py /app/backend/open_webui/google_drive_citations.py
COPY --from=citation-frontend /src/build /app/build
RUN python /tmp/patch-google-drive-runtime.py \
    && python /tmp/patch-google-drive-citations.py \
    && python /tmp/patch-knowledge-fs.py \
    && python /tmp/patch-model-visibility.py \
    && python /tmp/patch-whisper-prompt.py \
    && python /tmp/patch-turn-notices.py \
    && python /tmp/patch-qwen-tool-calls.py \
    && python /tmp/patch-datadog-prefetch.py \
    && python /tmp/test-knowledge-fs-patch.py \
    && rm /tmp/patch-google-drive-runtime.py /tmp/patch-google-drive-citations.py /tmp/patch-knowledge-fs.py /tmp/patch-model-visibility.py /tmp/patch-whisper-prompt.py /tmp/patch-turn-notices.py /tmp/patch-datadog-prefetch.py /tmp/patch-qwen-tool-calls.py /tmp/test-knowledge-fs-patch.py
