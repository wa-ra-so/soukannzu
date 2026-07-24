# 飲食店ネットワーク相関図 - データ管理スクリプト

飲食店オーナー・店舗・関係性のデータをCLIで入力管理し、JSONファイルに保存するツールです。

## ファイル構成

```
network-data/
├── manager.py               # CLIスクリプト本体
├── houjin_bangou_api.py     # 国税庁 法人番号公表サイトへの照会補助（照会のみ）
├── data/
│   └── network.json         # 保存先データ（初期状態は空）
└── README.md
```

## セットアップ

Python 3.8+ があれば追加の依存パッケージなしで動作します。

```bash
cd network-data
python manager.py --action stats
```

`--data-file` オプションでデータファイルの場所を変更できます（省略時は `data/network.json`）。

## データ構造

```json
{
  "metadata": {
    "updated_at": "2025-07-15T10:30:00",
    "area": "Chiba",
    "version": "1.0"
  },
  "owners": [
    {
      "id": "owner_001",
      "name": "山田太郎",
      "area": "市川",
      "group": "山田商事",
      "note": "市川駅前プラザ",
      "source": "manual | web | lcdb",
      "confidence": "sure | medium | low"
    }
  ],
  "shops": [
    {
      "id": "shop_001",
      "name": "ラーメンABC",
      "genre": "ラーメン",
      "owner_id": "owner_001",
      "area": "市川",
      "group": "山田商事",
      "address": "千葉県市川市...",
      "source": "manual | web | lcdb",
      "confidence": "sure | medium | low",
      "tabelog_url": "https://...",
      "salesforce_url": "https://...salesforce.com/..."
    }
  ],
  "relations": [
    {
      "id": "rel_001",
      "from_id": "owner_001",
      "to_id": "owner_002",
      "type": "same_building | family | business | other",
      "note": "商工会部会で知り合い",
      "source": "manual | web",
      "confidence": "sure | medium | low"
    }
  ]
}
```

## コマンド一覧

### 追加（CREATE）

```bash
# オーナー追加
python manager.py --action add_owner --name "山田太郎" --area "市川" --group "山田商事" \
    --note "市川駅前プラザ" --source manual --confidence sure

# 店舗追加（owner が存在しないと拒否される）
python manager.py --action add_shop --name "ラーメンABC" --genre "ラーメン" \
    --owner "owner_a1b2c3d4" --area "市川" --group "山田商事" \
    --address "千葉県市川市..." --tabelog-url "https://tabelog.com/..." \
    --salesforce-url "https://example.my.salesforce.com/001..."

# 関係追加（重複・自己参照・存在しないIDは拒否される）
python manager.py --action add_relation --from "owner_a1b2c3d4" --to "owner_e5f6g7h8" \
    --type "same_building" --note "商工会部会で知り合い"
```

### 一覧表示（READ）

```bash
# オーナー一覧
python manager.py --action list --type owners

# エリアで絞り込み
python manager.py --action list --type shops --area "市川"

# ジャンルで絞り込み
python manager.py --action list --type shops --genre "ラーメン"

# 特定ノードに関わる関係を一覧
python manager.py --action list --type relations --id "owner_a1b2c3d4"

# 汎用フィルタ（key:value をカンマ区切りで複数指定可）
python manager.py --action list --type shops --filter "area:市川,genre:ラーメン"
```

### 更新（UPDATE）

```bash
python manager.py --action update_owner --id "owner_a1b2c3d4" --note "更新メモ"
python manager.py --action update_shop --id "shop_xxxx" --address "新住所"
python manager.py --action update_relation --id "rel_xxxx" --type "business"
```

指定したフィールドのみが更新されます（未指定のフィールドは変更されません）。

### 削除（DELETE）

```bash
python manager.py --action delete_relation --id "rel_xxxx"
python manager.py --action delete_shop --id "shop_xxxx"

# オーナーに紐づく店舗が残っている場合は拒否される。
# 店舗と関連する relation もまとめて削除する場合は --cascade を付ける
python manager.py --action delete_owner --id "owner_a1b2c3d4" --cascade
```

### 検証

```bash
python manager.py --action validate
```

チェック内容：

- 重複ID（owners / shops / relations）
- 存在しないオーナーIDへの店舗登録
- 存在しないノードIDを参照する関係
- 重複する関係（同じノードペア）
- 自己参照の関係（`from_id == to_id`）
- 必須フィールド（`name`, `area`）の空チェック
- `source` / `confidence` の値の妥当性
- ⚠️ 警告：`confidence: sure` なのに `source` が `web` / `lcdb`（推測ソース）の場合

エラーが1件でもあれば終了コード1で終了します。

### エクスポート

```bash
# 生データをそのまま出力
python manager.py --action export
python manager.py --action export --output data/backup.json

# 相関図（ノード・エッジ形式）用に変換して出力
python manager.py --action export_for_html --output data/for_html.json
```

`export_for_html` は owners/shops を `nodes`、relations と owner-shop の紐付けを `edges` として
まとめた、可視化ツール向けの形式に変換します。

### インポート（他のJSONをマージ）

```bash
python manager.py --action import --file other_network.json
```

IDが既に存在するレコードはスキップされ、新規のレコードのみ追加されます。

### 統計

```bash
python manager.py --action stats
```

オーナー数・店舗数・関係数、エリア別/ジャンル別/関係タイプ別の集計を出力します。

## 使用例（一連の流れ）

```bash
python manager.py --action add_owner --name "山田太郎" --area "市川" --group "山田商事"
# => Added owner: owner_a1b2c3d4

python manager.py --action add_shop --name "ラーメンABC" --genre "ラーメン" \
    --owner "owner_a1b2c3d4" --area "市川" --group "山田商事"
# => Added shop: shop_b2c3d4e5

python manager.py --action add_owner --name "鈴木花子" --area "船橋" --group "鈴木物産"
# => Added owner: owner_e5f6g7h8

python manager.py --action add_relation --from "owner_a1b2c3d4" --to "owner_e5f6g7h8" \
    --type "same_building"
# => Added relation: rel_c3d4e5f6

python manager.py --action validate
python manager.py --action stats
python manager.py --action export --output data/network.json
```

## データ収集について

食べログやニュース記事の自動スクレイピングは、利用規約上のリスクが高いため
本プロジェクトでは行いません。以下の方針で、人が確認した情報の登録を補助します。

### 情報源ごとの登録チェックリスト

| 情報源 | 方法 | 登録コマンド例 |
|---|---|---|
| 法人番号公表サイト（国税庁） | `houjin_bangou_api.py` で商号照会（公式API・自動照会OK） | 照会結果を確認後、`update_owner`/`update_shop` で手動反映 |
| ニュース記事 | 自分で記事を読み、URLと概要を `note` に手入力 | `add_owner --note "2026年6月 千葉日報で開店記事あり" --source web --confidence medium` |
| 食べログ | 自分で確認したページのURLを `tabelog_url` に登録 | `add_shop --tabelog-url "https://tabelog.com/..." --source web --confidence medium` |
| Salesforce | 対応する取引先/商談のURLを `salesforce_url` に登録 | `add_shop --salesforce-url "https://example.my.salesforce.com/001..."` |
| 商工会・業界団体リスト | 手動入力 | `add_owner --source manual --confidence sure` |

### 法人番号照会（houjin_bangou_api.py）

```bash
# APIキー（アプリケーションID）は https://www.houjin-bangou.nta.go.jp/webapi/riyou/ から無料で取得
export HOUJIN_BANGOU_API_KEY="取得したアプリケーションID"

python houjin_bangou_api.py --name "山田商事"
```

このAPIで取得できるのは商号・法人番号・本店所在地のみで、**代表者名は含まれません**。
そのため「代表者名から複数企業を自動検出する」機能は実現できません。
同一代表者が複数の法人を持っていることに気づいた場合は、
`add_relation --type business` で手動で関連付けてください。

結果は表示されるだけで `network.json` へは自動反映されません。
内容を目視で確認したうえで `update_owner` / `update_shop` を使って反映してください。

### 法人番号による関係の自動提案（suggest_relations_by_corporate_number.py）

オーナー/店舗の `group`（グループ）欄を会社名とみなして法人番号を照会し、
**同じ法人番号に複数のオーナー/店舗が紐づいている場合に、関係の追加を提案**します。
「山田商事」と「(株)山田商事」のような表記ゆれがあっても、法人番号が一致すれば検出できます。

```bash
export HOUJIN_BANGOU_API_KEY="取得したアプリケーションID"
python suggest_relations_by_corporate_number.py
```

- 提案を表示するだけで、`network.json` への自動書き込みは行いません
- 表示された `add_relation` コマンドを確認したうえで、必要なものだけ手動実行してください
- 代表者名はAPIで取得できないため、**異なる会社名の間で同一オーナーを検出することはできません**
  （あくまで「同じ法人番号」という一致のみを検出します）

### 食べログ・Googleの口コミからの自動集約について

食べログには外部開発者向けの公式APIが無く、Googleも口コミの大量取得は利用規約上のリスクが
高いため、本プロジェクトではどちらも行いません。また口コミの本文には経営者や関係性の情報が
含まれないため、そもそも関係図の元データにはなりません。上記の法人番号照会が、公式かつ無料で
使える現実的な自動化手段です。

### 個人情報の取り扱いについて

- 登録するオーナー名は、法人の代表者として公開されている情報
  （登記簿・企業サイト・報道等）の範囲に限定してください
- 個人のプライベートな情報（自宅住所、個人の連絡先等）は登録しないでください
- データの利用目的（千葉県内飲食店ネットワークの可視化）以外に使わないでください
- 本人から削除の申し出があった場合は `delete_owner` で速やかに削除できます
