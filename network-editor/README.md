# 飲食店ネットワーク データ入力ページ

ブラウザだけで完結する、オーナー・店舗・関係の手入力用ツールです。
サーバーは不要で、`index.html` を開くだけで使えます（`network-visualizer` と同じ考え方の静的ページです）。

## できること

- オーナー・店舗・関係の追加・編集・削除（`manager.py` と同じCRUD）
- 店舗ごとに食べログ・SalesforceのURLを登録し、テーブル上のリンクからワンクリックで開ける
- `manager.py` の `validate()` と同じルールでの検証（重複ID・存在しない参照・自己参照・重複関係・必須項目・confidence/sourceの矛盾など）
- 入力内容はブラウザの localStorage に自動保存（タブを閉じても消えません。ブラウザ/端末をまたぐ永続化はできません）
- JSONの読み込み（`manager.py --action export` で出力した生データ形式）
- JSONのダウンロード（`network-data/data/network.json` に上書き保存して使う想定）
- 相関図表示ツール向けの変換書き出し（`network-visualizer` が読み込む nodes/edges 形式）

## 使い方

1. `index.html` をブラウザで開く
2. 「サンプルを読み込む」で動作を確認、または「📂 JSONを開く」で `network-data/data/network.json` を読み込む
3. 各タブ（オーナー/店舗/関係）の「＋ 追加」から入力
4. 「✅ 検証」でデータ整合性を確認
5. 「💾 JSONダウンロード」で `network.json` として保存し、`network-data/data/network.json` を置き換える
6. 相関図で見たい場合は「🕸️ 相関図用に書き出す」でnodes/edges形式に変換してダウンロードし、
   `network-visualizer/index.html` にドラッグ&ドロップする

## データの永続化について

このページは静的なHTMLで完結しており、ファイルシステムへ直接書き込むことはできません。
入力中のデータはブラウザのlocalStorageに自動保存されるため、誤ってタブを閉じても失われませんが、
別のブラウザ・別の端末からは見えません。**確定した内容は「JSONダウンロード」で書き出し、
`network-data/data/network.json` として保存してください。** それ以降は `manager.py` のCLIからも
同じデータを扱えます。

## manager.py との役割分担

| | manager.py (CLI) | network-editor (このページ) |
|---|---|---|
| 向いている用途 | 自動化・一括登録・スクリプト連携 | 人が画面を見ながら手入力 |
| 実行環境 | Python | ブラウザのみ |
| データの保存先 | 直接 `data/network.json` に書き込み | ダウンロードしたJSONを手動で配置 |

バリデーションルールは両者で同じものを使っています。
