FROM dhi.io/golang:1.26-debian13-dev AS builder
WORKDIR /build
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o netstress .

FROM dhi.io/static:20260413-alpine3.22
COPY --from=builder /build/netstress /netstress
EXPOSE 8080
ENTRYPOINT ["/netstress"]
