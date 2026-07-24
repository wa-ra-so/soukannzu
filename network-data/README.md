# 飲食店ネットワーク相関図 - データ管理スクリプト

飲食店オーナー・店舗・関係性のデータをCLIで入力管理し、JSONファイルに保存するツールです。

## ファイル構成

```
network-data/
├── manager.py                                   # CLIスクリプト本体
├── houjin_bangou_api.py                         # 法人番号Web-APIへの照会補助（要アプリケーションID・照会のみ）
├── houjin_bangou_csv.py                         # 法人番号「全件データCSV」読み込みモジュール（申請不要）
├── suggest_relations_by_corporate_number.py     # 同一法人のオーナー/店舗を検出し関係作成を提案
├── suggest_from_food_license_data.py            # 保健所の飲食店営業許可データから複数店舗オーナーを検出
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
| 法人番号公表サイト（国税庁） | 全件データCSV（申請不要・推奨）または`houjin_bangou_api.py`で商号照会 | 照会結果を確認後、`update_owner`/`update_shop` で手動反映 |
| ニュース記事 | 自分で記事を読み、URLと概要を `note` に手入力 | `add_owner --note "2026年6月 千葉日報で開店記事あり" --source web --confidence medium` |
| 食べログ | 自分で確認したページのURLを `tabelog_url` に登録 | `add_shop --tabelog-url "https://tabelog.com/..." --source web --confidence medium` |
| Salesforce | 対応する取引先/商談のURLを `salesforce_url` に登録 | `add_shop --salesforce-url "https://example.my.salesforce.com/001..."` |
| 商工会・業界団体リスト | 手動入力 | `add_owner --source manual --confidence sure` |

### 法人番号照会 - 2つの方法

法人番号公表サイトのデータは、2通りの方法で取得できる。**申請不要ですぐ使えるCSV方式を推奨**する。

| 方法 | 申請 | 反映までの時間 | 用途 |
|---|---|---|---|
| **全件データCSV（推奨）** | 不要 | 即時 | `suggest_relations_by_corporate_number.py --csv-file` |
| Web-API | 必要 | アプリケーションID発行に1〜1.5ヶ月ほど | `houjin_bangou_api.py` / `suggest_relations_by_corporate_number.py --api-key` |

いずれの方法でも取得できるのは商号・法人番号・本店所在地のみで、**代表者名は含まれません**。
そのため「代表者名から複数企業を自動検出する」ことはできません。
同一代表者が複数の法人を持っていることに気づいた場合は、`add_relation --type business` で
手動で関連付けてください。結果は表示されるだけで、どちらの方法でも `network.json` への
自動書き込みは行いません。

#### 全件データCSV（推奨・申請不要）

1. https://www.houjin-bangou.nta.go.jp/download/zenken/ から対象の都道府県（例: 千葉県）のCSVを
   ダウンロードする（アプリケーションID等の申請は不要）
2. `suggest_relations_by_corporate_number.py --csv-file` にダウンロードしたCSVのパスを渡す

```bash
python suggest_relations_by_corporate_number.py --csv-file /path/to/12_chiba_all_YYYYMMDD.csv
```

CSVはヘッダー行なしの固定列形式（列1=法人番号、列6=商号、列9〜11=都道府県/市区町村/番地）。
文字コードはUTF-8/Shift-JISのどちらでも自動判別する。

#### Web-API（houjin_bangou_api.py）

```bash
# アプリケーションIDは https://www.houjin-bangou.nta.go.jp/webapi/index.html から無料で発行できるが、
# 発行手続きに1〜1.5ヶ月ほどかかることがある
export HOUJIN_BANGOU_API_KEY="取得したアプリケーションID"

python houjin_bangou_api.py --name "山田商事"
python suggest_relations_by_corporate_number.py --api-key "$HOUJIN_BANGOU_API_KEY"
```

### 法人番号による関係の自動提案（suggest_relations_by_corporate_number.py）

オーナー/店舗の `group`（グループ）欄を会社名とみなして法人番号を照会し、
**同じ法人番号に複数のオーナー/店舗が紐づいている場合に、関係の追加を提案**します。
「山田商事株式会社」の表記が完全に一致していれば検出できますが、「山田商事」のような
省略形は同名の別法人が複数存在することが多く、**法人番号が一意に決まらない場合は
誤検出を避けるため提案をスキップし、警告を表示します**（正式名称での登録を推奨）。

- 提案を表示するだけで、`network.json` への自動書き込みは行いません
- 表示された `add_relation` コマンドを確認したうえで、必要なものだけ手動実行してください
- 代表者名はどちらの方法でも取得できないため、**異なる会社名の間で同一オーナーを検出することはできません**
  （あくまで「同じ法人番号」という一致のみを検出します）

### 飲食店営業許可データによる複数店舗オーナーの検出（suggest_from_food_license_data.py）

法人番号データには代表者名が含まれないという制約に対し、保健所が公開する
**「食品営業許可施設一覧」オープンデータ**には申請者名（＝実際のオーナー名。個人名の場合もある）が
含まれているため、**同じ人物/法人が複数の飲食店を経営しているケースをそのまま検出**できる。

1. 千葉県オープンデータサイトから対象地域のExcelファイルをダウンロード（申請不要・自由利用可）
   - 千葉市・船橋市・柏市は千葉県のデータに含まれないため、必要なら各市の公開データを別途利用する
2. `pip install openpyxl` （初回のみ）
3. 実行:

```bash
python suggest_from_food_license_data.py --xlsx-file 2605syokuhin1.xlsx 2605syokuhin2.xlsx
```

- 「業種」が飲食店営業(１)〜(４)・喫茶店営業のものだけに絞り込む（食肉販売業・菓子製造業などは対象外）
  ＝「飲食業界」に限定した検出になる
- 列の並び順はファイルによって異なることを確認済みのため、列名（ヘッダー行）から動的に読み取る
- 大手チェーン（惣菜・寿司作業室ごとに施設が分かれ、数十件ヒットすることがある）が結果の上位を
  占めやすいため、`--max-facilities 5` のように上限を指定すると、より小規模なオーナー候補に絞り込める
- 提案を表示するだけで、`network.json` への自動書き込みは行いません

### 食べログ・Googleの口コミからの自動集約について

食べログには外部開発者向けの公式APIが無く、Googleも口コミの大量取得は利用規約上のリスクが
高いため、本プロジェクトではどちらも行いません。また口コミの本文には経営者や関係性の情報が
含まれないため、そもそも関係図の元データにはなりません。上記の法人番号照会・飲食店営業許可データが、
公式かつ無料で使える現実的な自動化手段です。

### 個人情報の取り扱いについて

- 登録するオーナー名は、法人の代表者として公開されている情報
  （登記簿・企業サイト・報道等）の範囲に限定してください
- 個人のプライベートな情報（自宅住所、個人の連絡先等）は登録しないでください
- データの利用目的（千葉県内飲食店ネットワークの可視化）以外に使わないでください
- 本人から削除の申し出があった場合は `delete_owner` で速やかに削除できます
