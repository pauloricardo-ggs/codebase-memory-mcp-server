FROM cr.agentgateway.dev/agentgateway:v1.3.1 AS upstream

FROM cgr.dev/chainguard/git:latest@sha256:7671e64c37b99739fd52eb5ae4299e957c5095e083d6ee5dcd1845ce850a7614

COPY --from=upstream /app /app

WORKDIR /app
USER 65532:65532
ENTRYPOINT ["/app/agentgateway"]
