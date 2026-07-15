FROM cr.agentgateway.dev/agentgateway:v1.3.1 AS upstream

FROM cgr.dev/chainguard/git:latest

COPY --from=upstream /app /app

WORKDIR /app
USER 65532:65532
ENTRYPOINT ["/app/agentgateway"]
