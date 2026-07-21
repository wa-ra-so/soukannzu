# 飲食店ネットワーク相関図 - ズーム対応表示ツール

`network-data/manager.py --action export_for_html` が出力する JSON
（`nodes` / `edges` 形式）を読み込み、SVGで相関図を描画するブラウザツールです。
外部ライブラリに依存せず、`index.html` を開くだけで動作します。

## 使い方

1. `index.html` をブラウザで直接開く（ダブルクリックでOK）
2. 「📂 JSONを開く」ボタン、またはドラッグ&ドロップで
   `data/sample.json`（同梱のサンプル）や、`manager.py --action export_for_html`
   で生成した自分のデータを読み込む

> `?data=path/to/network.json` というクエリパラメータでの自動読み込みにも対応していますが、
> これは内部で `fetch()` を使うため、`file://` としてブラウザで直接開いた場合は
> ブラウザのセキュリティ制限により失敗します。使う場合は
> `python -m http.server` などローカルサーバー経由で開いてください。

```bash
# network-data 側でサンプルデータを作ったあと
cd network-data
python manager.py --action export_for_html --output ../network-visualizer/data/sample.json

# 表示側
cd ../network-visualizer
python -m http.server 8000
# ブラウザで http://localhost:8000/index.html を開く
```

## 操作方法

| 操作 | 動作 |
|---|---|
| マウスホイール | ズーム（カーソル位置を中心に拡大縮小、0.5〜3倍） |
| ドラッグ（背景） | パン（画面移動） |
| ドラッグ（ノード） | そのノードを移動して位置を固定（ピン留め、点線の枠で表示） |
| クリック（ノード） | つながり（ego network）をハイライトし、右側パネルに詳細と接続先一覧を表示 |
| クリック（背景） | 選択解除 |
| ダブルクリック（ノード上） | そのノードを中心に、拡大率1.5倍でアニメーション移動 |
| 🔎 検索ボックス | 名前でノードを検索し、候補から選ぶと選択＆中心表示 |
| ノード/関係線にマウスを乗せる | 名前・エリア・グループ・信頼度などをツールチップ表示 |
| 🔄 フィット | 現在表示中のノードが画面に収まるよう自動調整 |
| エリア/グループ ドロップダウン | 該当ノードのみ強調表示、それ以外はグレーアウトまたは非表示 |
| 💾 SVG保存 / PNG保存 | 現在の描画を画像として保存 |

右サイドパネルには「選択中のノード」の詳細（クリック時のみ表示）、凡例、統計が並びます。
選択中のノードのつながり一覧はクリックすると次のノードへジャンプでき、関係を辿って探索できます。

## データ形式

```json
{
  "metadata": { "updated_at": "...", "area": "Chiba", "version": "1.0" },
  "nodes": [
    { "id": "owner_xxx", "label": "山田太郎", "node_type": "owner", "area": "市川", "group": "山田商事", "confidence": "sure" },
    { "id": "shop_xxx",  "label": "ラーメンABC", "node_type": "shop", "area": "市川", "group": "山田商事", "genre": "ラーメン", "confidence": "sure",
      "tabelog_url": "https://tabelog.com/...", "salesforce_url": "https://example.my.salesforce.com/..." }
  ],
  "edges": [
    { "from_id": "owner_xxx", "to_id": "shop_xxx", "type": "owner_shop", "confidence": "sure" },
    { "from_id": "owner_xxx", "to_id": "owner_yyy", "type": "same_building", "confidence": "medium" }
  ]
}
```

`node_type` は `owner`（緑）または `shop`（青）。
`edges` の `type` によって線種と色を変えて表示しています（凡例参照）。
店舗ノードに `tabelog_url` / `salesforce_url` があれば、そのノードを選択したときに
右サイドパネルへ「食べログ ↗」「Salesforce ↗」のリンクとして表示されます（新しいタブで開きます）。

| type | 線種 |
|---|---|
| owner_shop | 実線・細 |
| same_building | 実線・中太 |
| family | 破線 |
| business | 実線・太 |
| other | 点線 |

## ファイル構成

```
network-visualizer/
├── index.html       # 相関図表示ツール本体
├── styles.css        # デザイン
├── script.js          # ズーム・パン・フィルタ・レイアウトロジック
├── data/
│   └── sample.json   # 動作確認用サンプルデータ（8オーナー・10店舗・4関係）
└── README.md
```

## レイアウトアルゴリズム

外部ライブラリを使わず、簡易的な Fruchterman-Reingold 法（力学モデル）を
`script.js` 内に自前実装しています。中心への弱い引力を加えて、鎖状に伸びたり
孤立した成分が画面端に飛び散ったりするのを抑えています。ノード数が500を超える場合は
反復回数を300回から30回に減らし、初期描画の待ち時間を抑えます。
ズーム倍率が0.5未満のとき、およびドラッグ中はラベル描画を省略して
負荷を下げます（描画自体を止めるわけではありません）。
手動でドラッグして固定した位置はそのセッション内で保持されますが、
JSONを読み込み直すとレイアウトは再計算されます。

## パフォーマンスの目安

数十〜数百ノード程度までは問題なく動作します。1000ノードを超えるような
大規模データの場合は、初期レイアウト計算に数秒かかることがあります。
