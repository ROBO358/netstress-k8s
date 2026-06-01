# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドです。

## 概要

**netstress-k8s** は `yh-cluster` ホームラボ向けの自作ネットワークストレスツール。

- **クライアントは Web ブラウザ** ─ `speedtest-k8s`（LibreSpeed）と同じ公開形態
- Go バックエンドが ①静的フロント配信 ②スループット計測エンドポイント の両方を担う
- GitHub リポジトリ: `ROBO358/netstress-k8s`
- コンテナイメージ: `ghcr.io/robo358/netstress-k8s` (linux/amd64)
- デプロイ先 namespace: `netstress`

## アーキテクチャ

```
ブラウザ (HTTPS)
    │
    ▼
Cilium Gateway / Cloudflare Tunnel
    │
    ▼
Go バックエンド (single binary, port 8080)
    ├── GET /          → 静的 HTML/CSS/JS フロント配信
    ├── TCP 計測       → HTTP chunked download/upload または WebSocket
    └── UDP 計測       → WebRTC DataChannel または WebTransport (QUIC)
```

### 伝送路の制約

ブラウザは生 TCP/UDP ソケットを扱えないため:

| 計測種別 | 伝送路の候補 | 備考 |
|---|---|---|
| TCP スループット | HTTP chunked / WebSocket | 実装がシンプル。最初はこれ。 |
| UDP スループット・RTT | WebRTC DataChannel | STUN/ICE が必要。Cilium CNP の UDP egress 追加が必要。 |
| UDP スループット・RTT | WebTransport (QUIC) | HTTP/3 対応が前提。将来検討。 |

**最初の実装**: TCP のみ (HTTP chunked download/upload) で始めて、後から UDP (WebRTC) を追加する
段階的アプローチを推奨する。

## リポジトリ構成（実装後の予定）

```
src/                    # CI build context: ./src
├── go.mod              # module github.com/robo358/netstress-k8s
├── main.go             # or cmd/netstress/main.go
├── static/             # HTML/CSS/JS フロント
│   ├── index.html
│   ├── style.css
│   └── app.js
└── Dockerfile          # FROM golang:1.24-alpine AS builder ... / FROM scratch or alpine

manifests/
├── kustomization.yaml  # ★ CI が newTag を自動更新
├── certificate.yaml
├── deployment.yaml
├── service.yaml
├── gateway.yaml
├── httproute.yaml
├── httproute-tunnel.yaml
└── ciliumnetworkpolicy.yaml

.github/workflows/
└── build.yml           # sample-app-k8s の build.yml を参考に netstress-k8s 向けに作成
```

## CI/CD フロー

```
src/** を push
  │
  ▼
GitHub Actions (build.yml)
  ├── docker build ./src → ghcr.io/robo358/netstress-k8s:sha-<short_sha>
  ├── ghcr.io/robo358/netstress-k8s:main タグも付与
  └── kustomize edit set image で manifests/kustomization.yaml の newTag を更新
        → "chore(image): bump to sha-<short_sha> [skip ci]" でコミット・プッシュ

Flux (homelab-gitops) が 1 分ごとにポーリング → manifests/ を netstress namespace に apply
```

参考: `ROBO358/sample-app-k8s` の `.github/workflows/build.yml`

## manifests/ 実装メモ

`speedtest-k8s/manifests/` を雛形にする（最小セット: PVC・ESO・ServiceMonitor 不要）。

### 置換リスト（speedtest → netstress）

| 項目 | speedtest 値 | netstress 値 |
|---|---|---|
| app ラベル | `speedtest` | `netstress` |
| namespace | `speedtest` | `netstress` |
| image | `ghcr.io/librespeed/speedtest:6.1.0` | `ghcr.io/robo358/netstress-k8s` |
| LB IP | `192.168.1.103` | 未定（下記参照） |
| TLS Secret | `speedtest-tls` | `netstress-tls` |
| Certificate CN | `speedtest.yh.k8s.tsuru.run` | `netstress.yh.k8s.tsuru.run` |
| LAN HTTPRoute hostname | `speedtest.yh.k8s.tsuru.run` | `netstress.yh.k8s.tsuru.run` |
| Tunnel HTTPRoute hostname | `speedtest-yh-k8s.tsuru.run` | `netstress-yh-k8s.tsuru.run` |

### LB IP の確定手順

既存割り当て: `192.168.1.102` (sample-app), `192.168.1.103` (speedtest)。
次に空いている IP を確認してから採番する:

```bash
# クラスタ上の全 Gateway の LB IP を確認
kubectl get gateway -A -o wide
# 候補は 192.168.1.104 だが、ルーター側の予約も確認すること
```

### CiliumNetworkPolicy の注意

TCP のみ実装時は `speedtest-k8s` の CNP と同型（HTTP 8080 の ingress のみ）でよい。

WebRTC (UDP) を追加する場合は以下を検討:
- STUN サーバへの egress (UDP 3478)
- ephemeral UDP ポート範囲の ingress（WebRTC の media/data チャネル）
- または自前 STUN/TURN を同 namespace に立てて intra-ns で解決

### securityContext

`nginxinc/nginx-unprivileged` ではなく Go バイナリを直接実行するため:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534   # nobody
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

`fsGroup` や `chown` は不要（PVC を使わない）。

## homelab-gitops への登録手順（次セッション完了後）

1. GitHub に `ROBO358/netstress-k8s` リポジトリを作成
2. `git push -u origin main`
3. `homelab-gitops/apps/` に `netstress/` ディレクトリを追加:
   - `namespace.yaml` — namespace `netstress`、PodSecurity Baseline
   - `rbac.yaml` — SA + Flux Kustomization 用 ClusterRoleBinding
   - `referencegrant.yaml` — cloudflare-gateway からの HTTPRoute 参照許可
   - `source.yaml` — GitRepository + Kustomization（`dependsOn: cilium-config, cert-manager-config, cloudflare-gateway-config`。longhorn / external-secrets は不要）
   - `kustomization.yaml` — 上記をまとめる
4. `homelab-gitops/apps/kustomization.yaml` に `netstress` を追記

`sample-app-k8s` の homelab-gitops 側ファイル (`homelab-gitops/apps/sample-app/`) が参考になる。
ただし ESO (externalsecrets-config) / Longhorn の `dependsOn` は不要。

## 開発 TODO チェックリスト

次セッションで取り組む作業:

- [ ] `src/go.mod` 初期化 (`go mod init github.com/robo358/netstress-k8s`)
- [ ] Go バックエンド実装（最低限: 静的配信 + HTTP chunked download/upload）
- [ ] 静的フロント (`src/static/`)
- [ ] `src/Dockerfile` (マルチステージビルド、non-root 実行)
- [ ] `manifests/` 一式 (speedtest-k8s を雛形に上記置換リストを適用)
- [ ] `.github/workflows/build.yml` (sample-app-k8s を雛形)
- [ ] GitHub `ROBO358/netstress-k8s` リポジトリ作成 + push
- [ ] homelab-gitops `apps/netstress/` 登録
- [ ] LB IP の確定・gateway.yaml への反映
- [ ] Flux reconcile 確認・動作テスト

## グローバル規約（再掲）

- `kubectl` のグローバルフラグ (`-n` / `--namespace`) は**サブコマンドの後ろ**に置く
  - NG: `kubectl -n netstress get pods`
  - OK: `kubectl get pods -n netstress`
- git コミットメッセージに `Co-Authored-By: Claude ...` を含めない
