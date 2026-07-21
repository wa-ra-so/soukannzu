# soukannzu（飲食店ネットワーク相関図）

千葉県内の飲食店オーナー・店舗・関係性を、データ入力→相関図表示までブラウザだけで
完結できるツール。GitHub Pagesで公開。

- **公開URL**: https://wa-ra-so.github.io/soukannzu/

## 仕組み

| ファイル/ディレクトリ | 役割 |
|---|---|
| `index.html` | データ入力・相関図の統合ツール本体（上部タブで切り替え） |
| `styles.css` | 共有デザイントークン + 各ビューのスタイル |
| `editor.js` | データ入力ビューのロジック（CRUD・検証・localStorage自動保存） |
| `visualizer.js` | 相関図ビューのロジック（ズーム・パン・検索・ドラッグ固定） |
| `network-data/` | Python CLI（`manager.py`）。自動化・一括登録・法人番号照会向け |
| `network-editor/` | データ入力ページ単体版（統合前の個別ツール、引き続き利用可） |
| `network-visualizer/` | 相関図表示ツール単体版（同上） |

「📝 データ入力」タブで入力した内容は、「🕸️ 相関図」タブに切り替えるたびに自動で
反映されます。データはブラウザのlocalStorageに自動保存され、「💾 JSONダウンロード」で
書き出したファイルは `network-data/manager.py` のCLIでも扱えます。

## ローカルで動かす

```bash
python -m http.server 8000
# http://localhost:8000/ を開く
```

## データの取り扱いについて

このプロジェクトはオーナー個人名を含むデータを扱います。食べログ等の自動スクレイピングは
利用規約上のリスクが高いため行っておらず、情報は人が確認したうえで手動登録する運用として
います。個人情報の取り扱いに関する注意事項は [`network-data/README.md`](network-data/README.md)
を参照してください。

## その他のツール

- [`network-data/README.md`](network-data/README.md)：CLIのCRUD・検証・法人番号照会
- [`network-editor/README.md`](network-editor/README.md)：データ入力ページ単体版
- [`network-visualizer/README.md`](network-visualizer/README.md)：相関図表示ツール単体版
