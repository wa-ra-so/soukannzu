#!/usr/bin/env python3
"""法人番号公表サイトWeb-APIを使い、同じ法人番号を持つオーナー/店舗を検出して関係作成を提案する

- houjin_bangou_api.py の商号照会（公式API・無料）を使うだけで、スクレイピングは行わない
- オーナー/店舗の「グループ」欄を会社名とみなして照会する
  （代表者名はこのAPIでは取得できないため、あくまで「同じ会社に属していそうか」の検出に留まる）
- 結果は提示するだけで、network.json への自動書き込みは行わない
  提案されたコマンドを確認したうえで manager.py --action add_relation で手動反映すること
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from houjin_bangou_api import search_by_company_name


def load_network(data_file):
    with open(data_file, encoding='utf-8') as f:
        return json.load(f)


def already_related(data, id_a, id_b):
    for r in data.get('relations', []):
        if {r.get('from_id'), r.get('to_id')} == {id_a, id_b}:
            return True
    return False


def collect_grouped_entities(data):
    entities = []
    for o in data.get('owners', []):
        if o.get('group'):
            entities.append(('オーナー', o['id'], o['name'], o['group']))
    for s in data.get('shops', []):
        if s.get('group'):
            entities.append(('店舗', s['id'], s['name'], s['group']))
    return entities


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data-file', default='data/network.json', help='network.jsonのパス')
    parser.add_argument(
        '--api-key',
        default=os.environ.get('HOUJIN_BANGOU_API_KEY'),
        help='法人番号Web-APIのアプリケーションID（環境変数 HOUJIN_BANGOU_API_KEY でも指定可）',
    )
    args = parser.parse_args()

    if not args.api_key:
        print(
            'エラー: APIキー（アプリケーションID）が指定されていません。\n'
            '取得方法: https://www.houjin-bangou.nta.go.jp/webapi/riyou/ から利用申請してください（無料）。',
            file=sys.stderr,
        )
        sys.exit(1)

    data = load_network(args.data_file)
    entities = collect_grouped_entities(data)
    if not entities:
        print('「グループ」欄が設定されているオーナー/店舗が見つかりませんでした。')
        return

    by_corporate_number = {}
    lookup_cache = {}
    for kind, entity_id, name, group in entities:
        if group not in lookup_cache:
            try:
                results = search_by_company_name(group, args.api_key, mode='1')
            except Exception as e:
                print(f'[警告] "{group}" の照会に失敗しました: {e}', file=sys.stderr)
                lookup_cache[group] = None
                continue
            lookup_cache[group] = results[0] if results else None
        corp = lookup_cache[group]
        if not corp:
            continue
        corporate_number = corp.get('corporateNumber')
        bucket = by_corporate_number.setdefault(corporate_number, {'company': corp.get('name'), 'members': []})
        bucket['members'].append((kind, entity_id, name, group))

    suggestions = []
    for corporate_number, info in by_corporate_number.items():
        members = info['members']
        if len(members) < 2:
            continue
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = members[i], members[j]
                if already_related(data, a[1], b[1]):
                    continue
                suggestions.append((info['company'], corporate_number, a, b))

    if not suggestions:
        print('新たに提案できる関係は見つかりませんでした（法人番号の一致なし、または既に登録済み）。')
        return

    print(f'{len(suggestions)}件の関係を提案します（法人番号が一致し、未登録のペア）。\n')
    for company, corporate_number, a, b in suggestions:
        a_kind, a_id, a_name, a_group = a
        b_kind, b_id, b_name, b_group = b
        print(f'- {a_name}({a_kind}: {a_group}) と {b_name}({b_kind}: {b_group})')
        print(f'  同じ法人「{company}」(法人番号: {corporate_number}) の可能性があります。')
        print(
            '  追加するには: python manager.py --action add_relation '
            f'--from {a_id} --to {b_id} --type business '
            f'--note "法人番号照会により検出: {company} ({corporate_number})"\n'
        )


if __name__ == '__main__':
    main()
