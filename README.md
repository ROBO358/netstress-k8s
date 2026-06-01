# netstress-k8s

ブラウザ駆動の TCP/UDP スループット計測ツール。自作 Go バックエンドが Web フロントを配信し、
ブラウザ経由でネットワーク負荷をかける。`yh-cluster` ホームラボ向け。

## 概要

| 項目 | 値 |
|---|---|
| GitHub | `ROBO358/netstress-k8s` |
| コンテナイメージ | `ghcr.io/robo358/netstress-k8s` (linux/amd64) |
| namespace | `netstress` |
| LAN URL | `netstress.yh.k8s.tsuru.run` |
| Internet URL | `netstress-yh-k8s.tsuru.run` (Cloudflare Tunnel) |

## 仕組み

ブラウザは生 TCP/UDP ソケットを扱えないため、以下の伝送路を使う:

- **TCP 計測**: HTTP(S) / WebSocket による大容量データ転送
- **UDP 計測**: WebRTC DataChannel または WebTransport (QUIC) による往復遅延・パケットロス測定

Go バックエンドが ① 静的フロント配信 ② 計測エンドポイント の両方を担う単一バイナリ構成。

## リポジトリ構成

```
src/                        # アプリケーション本体 → ghcr.io/robo358/netstress-k8s
├── go.mod                  # Go モジュール定義
├── main.go (or cmd/)       # エントリポイント
├── static/                 # 静的 Web フロント (HTML/CSS/JS)
└── Dockerfile              # CI の build context は ./src

manifests/                  # Kubernetes マニフェスト (Flux が直接 apply)
├── kustomization.yaml      # ★ CI が自動で image tag を更新
├── certificate.yaml
├── deployment.yaml
├── service.yaml
├── gateway.yaml
├── httproute.yaml
├── httproute-tunnel.yaml
└── ciliumnetworkpolicy.yaml

.github/workflows/
└── build.yml               # src/** push → build → push → kustomization.yaml 更新
```

> **現状**: スケルトンのみ。`src/` と `manifests/` は空。実装は次の開発セッションで行う。

## イメージビルド & リリースフロー

`src/**` を push すると GitHub Actions が起動:

1. `ghcr.io/robo358/netstress-k8s:sha-<short>` と `:main` をビルド・push
2. `manifests/kustomization.yaml` の `newTag` を `sha-<short>` に更新してコミット (`[skip ci]`)
3. Flux が `yh-cluster` へ ~1 分以内に apply

`manifests/` のみ変更した場合は CI は走らず、Flux が直接 apply する。

## homelab-gitops との責任分界

| 責務 | 配置先 |
|---|---|
| Namespace, PodSecurity | homelab-gitops `apps/netstress/namespace.yaml` |
| RBAC (SA / ClusterRoleBinding) | homelab-gitops `apps/netstress/rbac.yaml` |
| ReferenceGrant (cloudflare-gateway 参照許可) | homelab-gitops `apps/netstress/referencegrant.yaml` |
| GitRepository / Flux Kustomization | homelab-gitops `apps/netstress/source.yaml` |
| アプリ workload (Deployment / Service 等) | **このリポジトリ** `manifests/` |

**このリポジトリの `manifests/` に SA / ClusterRole / Binding を置いてはいけない**
(RBAC monotonicity 制約 — homelab-gitops 側が RBAC 境界を保持する)。

## 関連リポジトリ

- [`ROBO358/homelab-gitops`](https://github.com/ROBO358/homelab-gitops) — GitOps 定義
- [`ROBO358/sample-app-k8s`](https://github.com/ROBO358/sample-app-k8s) — アプリリポジトリのテンプレート
- [`ROBO358/speedtest-k8s`](https://github.com/ROBO358/speedtest-k8s) — マニフェスト構成の参考 (LibreSpeed)
