# 飲食店ネットワーク相関図

千葉県内の飲食店オーナー・店舗・関係性を管理し、相関図として可視化するプロジェクトです。
3つの独立したツールで構成されています。

```
soukannzu/
├── network-data/         # データ管理CLI（自動化・一括登録・検証・エクスポート向け）
├── network-editor/        # 手入力用ページ（ブラウザ完結、CRUDフォーム）
└── network-visualizer/   # 相関図表示ツール（ズーム・パン・検索・フィルタ付きHTML）
```

## 全体の使い方

### CLIで入力する場合

```bash
cd network-data
python manager.py --action add_owner --name "山田太郎" --area "市川" --group "山田商事"
python manager.py --action add_shop --name "ラーメンABC" --owner "owner_xxxx" --area "市川"
python manager.py --action validate
python manager.py --action export_for_html --output ../network-visualizer/data/sample.json
```

### ブラウザで手入力する場合

```bash
cd network-editor
python -m http.server 8001
# http://localhost:8001/index.html を開いて入力
# 「💾 JSONダウンロード」→ network-data/data/network.json に配置
# 「🕸️ 相関図用に書き出す」→ network-visualizer にそのまま読み込める
```

### 相関図を見る

```bash
cd network-visualizer
python -m http.server 8000
# http://localhost:8000/index.html を開いて JSON を読み込む
# ノードはドラッグして固定、クリックでつながりをハイライト、検索ボックスで名前から探せる
```

## 各ツールの詳細

- [network-data/README.md](network-data/README.md)：CLIのCRUD・検証・法人番号照会・データ収集についての注意事項
- [network-editor/README.md](network-editor/README.md)：手入力ページの使い方とmanager.pyとの役割分担
- [network-visualizer/README.md](network-visualizer/README.md)：相関図表示ツールの操作方法

## データの取り扱いについて

このプロジェクトはオーナー個人名を含むデータを扱います。
食べログ等の自動スクレイピングは利用規約上のリスクが高いため行っておらず、
情報は人が確認したうえで手動登録する運用としています。
個人情報の取り扱いに関する注意事項は `network-data/README.md` を参照してください。
