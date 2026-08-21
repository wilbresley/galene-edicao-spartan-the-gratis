FROM golang:1.24-alpine AS build
WORKDIR /src
COPY vendor/galene/ .
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/galene .
RUN mkdir -p /out/static && cp -a static/. /out/static/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 1000 galene
WORKDIR /app
COPY --from=build --chown=galene:galene /out/galene /app/galene
COPY --from=build --chown=galene:galene /out/static /app/static
USER galene
ENTRYPOINT ["/app/galene"]
