#!/usr/bin/env python3
"""保健所公開の「食品営業許可施設一覧」オープンデータから、同じ申請者(オーナー)が
複数の飲食店営業許可を持つケースを検出し、network.jsonへの登録を提案する

- 千葉県オープンデータ（申請不要・自由利用可）のExcelファイルをそのまま読み込む
  例: 千葉県「食品営業許可施設一覧」（習志野・市川・松戸・野田 等、健康福祉センター単位でシート分割）
- 「業種」が飲食店営業(１)〜(４)・喫茶店営業のもの（＝飲食業界）だけに絞り込む
  （食肉販売業・菓子製造業など、飲食店営業以外の食品関連許可は対象外）
- 法人番号データと異なり、このデータには申請者名（＝実際のオーナー名）が含まれるため、
  同じ申請者が複数施設を持っているケースをそのまま検出できる
- 結果は提示するだけで、network.json への自動書き込みは行わない
  提案されたコマンドを確認したうえで manager.py で手動反映すること

列名は仕様書ではなく実データのヘッダー行から動的に取得する
（許可年月日と初回許可年月日の列順がファイルによって異なることを確認済みのため）
"""

import argparse
import json
import sys
from pathlib import Path

RESTAURANT_TYPE_PREFIXES = ('飲食店営業',)
RESTAURANT_TYPE_EXACT = ('喫茶店営業',)

REQUIRED_COLUMNS = [
    '申請者＿申請者名',
    '施設＿名称（屋号・商号）１',
    '施設＿名称（屋号・商号）２',
    '所在地１',
    '所在地２',
    '施設＿電話番号１（所在地）',
    '業種',
    '指令番号（許可番号）',
]


def is_restaurant_type(gyoshu):
    if not gyoshu:
        return False
    return gyoshu.startswith(RESTAURANT_TYPE_PREFIXES) or gyoshu in RESTAURANT_TYPE_EXACT


def load_facilities(xlsx_paths, restaurant_only=True):
    try:
        import openpyxl
    except ImportError:
        print('エラー: openpyxlが必要です。 pip install openpyxl でインストールしてください。', file=sys.stderr)
        sys.exit(1)

    facilities = []
    for path in xlsx_paths:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                continue
            headers = [str(h).strip() if h is not None else '' for h in rows[0]]
            missing = [c for c in REQUIRED_COLUMNS if c not in headers]
            if missing:
                print(
                    f'[警告] {path} のシート「{sheet_name}」に想定した列が見つかりません（スキップ）: {missing}',
                    file=sys.stderr,
                )
                continue
            col = {name: headers.index(name) for name in REQUIRED_COLUMNS}
            for row in rows[1:]:
                if not row or all(v is None for v in row):
                    continue
                applicant = (row[col['申請者＿申請者名']] or '').strip() if row[col['申請者＿申請者名']] else ''
                if not applicant:
                    continue
                gyoshu = (row[col['業種']] or '').strip() if row[col['業種']] else ''
                if restaurant_only and not is_restaurant_type(gyoshu):
                    continue
                name1 = (row[col['施設＿名称（屋号・商号）１']] or '').strip()
                name2 = (row[col['施設＿名称（屋号・商号）２']] or '').strip()
                facility_name = name1 or name2
                if name2 and name2 != name1:
                    facility_name = f'{name1}（{name2}）' if name1 else name2
                addr1 = (row[col['所在地１']] or '').strip()
                addr2 = (row[col['所在地２']] or '').strip()
                address = addr1 + (f' {addr2}' if addr2 else '')
                facilities.append({
                    'applicant': applicant,
                    'facility_name': facility_name,
                    'address': address,
                    'phone': (row[col['施設＿電話番号１（所在地）']] or '').strip(),
                    'gyoshu': gyoshu,
                    'permit_number': row[col['指令番号（許可番号）']],
                    'source_file': str(path),
                    'sheet': sheet_name,
                })
    return facilities


def group_by_applicant(facilities):
    groups = {}
    for f in facilities:
        groups.setdefault(f['applicant'], []).append(f)
    # 同一施設の重複行（許可種別違いなど）は施設名+住所で dedupe
    deduped = {}
    for applicant, items in groups.items():
        seen = {}
        for it in items:
            key = (it['facility_name'], it['address'])
            seen.setdefault(key, it)
        deduped[applicant] = list(seen.values())
    return deduped


def load_network(data_file):
    path = Path(data_file)
    if not path.exists():
        return {'owners': [], 'shops': [], 'relations': []}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--xlsx-file', nargs='+', required=True, help='千葉県オープンデータのxlsxファイル（複数指定可）')
    parser.add_argument('--data-file', default='data/network.json', help='network.jsonのパス（既存登録との突き合わせに使用）')
    parser.add_argument('--min-facilities', type=int, default=2, help='この件数以上の施設を持つ申請者のみ表示（既定: 2）')
    parser.add_argument(
        '--max-facilities', type=int, default=None,
        help='この件数以下の申請者のみ表示（大手チェーンを除外して小規模な複数店舗オーナーに絞りたい場合に指定。例: 5）',
    )
    parser.add_argument(
        '--include-all-food-types', action='store_true',
        help='飲食店営業/喫茶店営業以外（食肉販売業・菓子製造業等）も含める（既定は飲食店営業のみに絞る）',
    )
    args = parser.parse_args()

    facilities = load_facilities(args.xlsx_file, restaurant_only=not args.include_all_food_types)
    if not facilities:
        print('対象データが見つかりませんでした。')
        return

    groups = group_by_applicant(facilities)
    multi = {
        k: v for k, v in groups.items()
        if len(v) >= args.min_facilities and (args.max_facilities is None or len(v) <= args.max_facilities)
    }
    if not multi:
        print('条件に合う申請者は見つかりませんでした。')
        return

    data = load_network(args.data_file)
    existing_owner_names = {o['name'] for o in data.get('owners', [])}
    existing_shop_names = {s['name'] for s in data.get('shops', [])}

    print(f'{len(multi)}件の申請者が複数の飲食店営業許可を持っています（飲食業界に絞り込み済み）。\n')
    for applicant, items in sorted(multi.items(), key=lambda kv: -len(kv[1])):
        already_owner = applicant in existing_owner_names
        print(f'■ {applicant}（{len(items)}施設）{"※既にオーナー登録済み" if already_owner else ""}')
        for it in items:
            already_shop = it['facility_name'] in existing_shop_names
            mark = '既存' if already_shop else '未登録'
            print(f'  - [{mark}] {it["facility_name"]} / {it["address"]} / {it["gyoshu"]}')
        if not already_owner:
            print(
                f'  追加するには: python manager.py --action add_owner --name "{applicant}" '
                f'--area "千葉" --source web --confidence medium '
                f'--note "食品営業許可データより {len(items)}施設を確認"'
            )
        print()


if __name__ == '__main__':
    main()
