# 飲食店ネットワーク相関図

千葉県内の飲食店オーナー・店舗・関係性を管理し、相関図として可視化するプロジェクトです。
2つの独立したツールで構成されています。

```
soukannzu/
├── network-data/         # データ管理CLI（入力・更新・検証・エクスポート）
└── network-visualizer/   # 相関図表示ツール（ズーム・パン・フィルタ付きHTML）
```

## 全体の使い方

```bash
# 1. データを入力・管理する
cd network-data
python manager.py --action add_owner --name "山田太郎" --area "市川" --group "山田商事"
python manager.py --action add_shop --name "ラーメンABC" --owner "owner_xxxx" --area "市川"
python manager.py --action validate

# 2. 表示ツール用にエクスポート
python manager.py --action export_for_html --output ../network-visualizer/data/sample.json

# 3. ブラウザで相関図を確認
cd ../network-visualizer
python -m http.server 8000
# http://localhost:8000/index.html を開いて JSON を読み込む
```

## 各ツールの詳細

- [network-data/README.md](network-data/README.md)：CRUD・検証・法人番号照会・データ収集についての注意事項
- [network-visualizer/README.md](network-visualizer/README.md)：相関図表示ツールの操作方法

## データの取り扱いについて

このプロジェクトはオーナー個人名を含むデータを扱います。
食べログ等の自動スクレイピングは利用規約上のリスクが高いため行っておらず、
情報は人が確認したうえで手動登録する運用としています。
個人情報の取り扱いに関する注意事項は `network-data/README.md` を参照してください。
