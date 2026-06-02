package main

import (
	"embed"
	"io"
	"io/fs"
	"log"
	"math/rand"
	"net/http"
	"strconv"
)

//go:embed static
var staticFiles embed.FS

func main() {
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(staticFS)))
	mux.HandleFunc("/ping", handlePing)
	mux.HandleFunc("/download", handleDownload)
	mux.HandleFunc("/upload", handleUpload)

	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}

func handlePing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	mb := 100
	if s := r.URL.Query().Get("size"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 1000 {
			mb = n
		}
	}

	total := int64(mb) * 1024 * 1024

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	const chunkSize = 64 * 1024
	buf := make([]byte, chunkSize)
	rand.Read(buf)

	var written int64
	for written < total {
		n := int64(chunkSize)
		if remaining := total - written; remaining < n {
			n = remaining
		}
		nw, err := w.Write(buf[:n])
		written += int64(nw)
		if err != nil {
			return
		}
	}
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")

	n, err := io.Copy(io.Discard, r.Body)
	if err != nil {
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"received":` + strconv.FormatInt(n, 10) + `}`))
}
