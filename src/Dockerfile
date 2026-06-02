FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o netstress .

FROM scratch
COPY --from=builder /build/netstress /netstress
EXPOSE 8080
ENTRYPOINT ["/netstress"]
