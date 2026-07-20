ARG OPENWEBUI_COMMIT=ecd48e2f718220a6400ecf49eafd4867a38feb10

FROM node:22-alpine3.20 AS citation-frontend
ARG OPENWEBUI_COMMIT
WORKDIR /src
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apk add --no-cache git \
    && wget -qO /tmp/openwebui.tar.gz "https://codeload.github.com/open-webui/open-webui/tar.gz/${OPENWEBUI_COMMIT}" \
    && tar -xzf /tmp/openwebui.tar.gz --strip-components=1 -C /src \
    && rm /tmp/openwebui.tar.gz
RUN npm ci --force
RUN npm run pyodide:fetch
COPY patch-openwebui-citations.mjs /tmp/patch-openwebui-citations.mjs
RUN node /tmp/patch-openwebui-citations.mjs /src/src/lib/components/chat/Messages/Citations.svelte \
    && ./node_modules/.bin/vite build

FROM ghcr.io/open-webui/open-webui:v0.10.2

COPY patch-google-drive-runtime.py /tmp/patch-google-drive-runtime.py
COPY patch-google-drive-citations.py /tmp/patch-google-drive-citations.py
COPY patch-knowledge-fs.py /tmp/patch-knowledge-fs.py
COPY test-knowledge-fs-patch.py /tmp/test-knowledge-fs-patch.py
COPY google_drive_citations.py /app/backend/open_webui/google_drive_citations.py
COPY --from=citation-frontend /src/build /app/build
RUN python /tmp/patch-google-drive-runtime.py \
    && python /tmp/patch-google-drive-citations.py \
    && python /tmp/patch-knowledge-fs.py \
    && python /tmp/test-knowledge-fs-patch.py \
    && rm /tmp/patch-google-drive-runtime.py /tmp/patch-google-drive-citations.py /tmp/patch-knowledge-fs.py /tmp/test-knowledge-fs-patch.py
