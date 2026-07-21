# 飲食店ネットワーク相関図・データ入力（統合版）

`network-editor`（手入力）と `network-visualizer`（相関図表示）を1つのページに統合し、
上部のタブで切り替えられるようにしたツールです。サーバー不要で `index.html` を開くだけで
動作します。

## 使い方

1. `index.html` をブラウザで開く（デフォルトは「📝 データ入力」タブ）
2. 「サンプルを読み込む」またはオーナー・店舗・関係を入力
3. 上部の「🕸️ 相関図」タブに切り替えると、入力した内容がそのまま相関図として表示される
   （手動でのエクスポート/インポートは不要）
4. 相関図タブで検索・ズーム・ドラッグでノードを固定・クリックでつながりを確認
5. 内容を確定したら「💾 JSONダウンロード」で `network.json` として保存し、
   `network-data/data/network.json` に配置すれば `manager.py` のCLIからも同じデータを扱える

## タブ切り替えの仕組み

「📝 データ入力」タブで編集した内容（`owners`/`shops`/`relations`）は、
「🕸️ 相関図」タブに切り替えるたびに自動的に `nodes`/`edges` 形式へ変換されて
相関図に反映されます。相関図タブ側で個別にJSONファイルを読み込んだ場合は、
そのデータが表示されますが、データ入力タブへは切り替えても戻ってきません
（データ入力タブが唯一の入力元で、相関図タブ→データ入力タブへの逆方向の同期は行いません）。

## ファイル構成

```
network-app/
├── index.html      # アプリシェル（ナビゲーション + 2つのビュー）
├── styles.css      # 共有トークン + 各ビューのスタイル（#view-editor / #view-visualizer に分離）
├── editor.js       # データ入力ビューのロジック（network-editor/script.js 相当）
├── visualizer.js   # 相関図ビューのロジック（network-visualizer/script.js 相当）
└── README.md
```

各ビューのDOM要素IDは `ed-` / `viz-` のプレフィックスを付けて衝突を避けています
（例: `ed-statOwners` / `viz-statOwners`）。ロジック自体は `network-editor` /
`network-visualizer` と同じで、統合のためにIDのプレフィックス付与とタブ切り替え・
同期用の橋渡しコードを追加しただけです。

## network-editor / network-visualizer との関係

`network-editor/` と `network-visualizer/` は単体でも動作する独立ページとして
そのまま残しています。単体ページとして共有したい場合や、片方だけ使いたい場合は
そちらを、両方を行き来しながら使いたい場合はこの `network-app/` を使ってください。
機能・バリデーションルールはすべて共通です。
