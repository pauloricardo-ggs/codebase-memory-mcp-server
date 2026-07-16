FROM ghcr.io/open-webui/open-webui:v0.10.2

COPY patch-google-drive-runtime.py /tmp/patch-google-drive-runtime.py
RUN python /tmp/patch-google-drive-runtime.py \
    && rm /tmp/patch-google-drive-runtime.py
