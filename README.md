# 飲食店ネットワーク相関図

千葉県内の飲食店オーナー・店舗・関係性を管理し、相関図として可視化するプロジェクトです。

```
soukannzu/
├── network-data/         # データ管理CLI（自動化・一括登録・検証・エクスポート向け）
├── network-app/          # データ入力+相関図をタブ切り替えできる統合ページ（推奨）
├── network-editor/        # 手入力用ページ単体（ブラウザ完結、CRUDフォーム）
└── network-visualizer/   # 相関図表示ツール単体（ズーム・パン・検索・フィルタ付きHTML）
```

## 全体の使い方

### ブラウザで完結させる場合（推奨）

```bash
cd network-app
python -m http.server 8002
# http://localhost:8002/index.html を開く
# 「📝 データ入力」タブで入力 → 「🕸️ 相関図」タブに切り替えると自動反映される
# 確定したら「💾 JSONダウンロード」→ network-data/data/network.json に配置
```

### CLIで入力する場合

```bash
cd network-data
python manager.py --action add_owner --name "山田太郎" --area "市川" --group "山田商事"
python manager.py --action add_shop --name "ラーメンABC" --owner "owner_xxxx" --area "市川"
python manager.py --action validate
python manager.py --action export_for_html --output ../network-visualizer/data/sample.json
```

### 手入力ページ・相関図ツールを単体で使う場合

`network-editor/` と `network-visualizer/` はそれぞれ単体でも動作します。
片方だけ共有したい場合や、`network-app` を使わない場合はこちらを使ってください。

```bash
cd network-editor && python -m http.server 8001   # 手入力のみ
cd network-visualizer && python -m http.server 8000 # 相関図表示のみ
```

## 各ツールの詳細

- [network-data/README.md](network-data/README.md)：CLIのCRUD・検証・法人番号照会・データ収集についての注意事項
- [network-app/README.md](network-app/README.md)：統合ページの使い方（データ入力→相関図の自動反映の仕組み）
- [network-editor/README.md](network-editor/README.md)：手入力ページ単体の使い方とmanager.pyとの役割分担
- [network-visualizer/README.md](network-visualizer/README.md)：相関図表示ツール単体の操作方法

## データの取り扱いについて

このプロジェクトはオーナー個人名を含むデータを扱います。
食べログ等の自動スクレイピングは利用規約上のリスクが高いため行っておらず、
情報は人が確認したうえで手動登録する運用としています。
個人情報の取り扱いに関する注意事項は `network-data/README.md` を参照してください。
