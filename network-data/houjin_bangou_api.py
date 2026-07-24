#!/usr/bin/env python3
"""国税庁 法人番号公表サイト Web-API による商号照会

商号（会社名）から法人番号・本店所在地を検索するだけの照会ツール。
- スクレイピングは行わない（公式APIのみ使用）
- 代表者名はこのAPIのレスポンスに含まれないため取得できない
  （「同一代表者の複数企業を自動検出する」機能はこのAPIでは実現不可能）
- 結果を表示するだけで、network.json への自動書き込みは行わない。
  内容を確認したうえで manager.py --action update_owner / update_shop 等を
  使って手動で反映すること。

APIキー（アプリケーションID）の取得:
  https://www.houjin-bangou.nta.go.jp/webapi/index.html から無料で発行できるが、
  発行手続きに1〜1.5ヶ月ほどかかることがある。すぐに使いたい場合は houjin_bangou_csv.py
  （申請不要・即時ダウンロード可能な全件データCSVを使うオフライン照会）を利用すること。
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API_URL = 'https://api.houjin-bangou.nta.go.jp/4/name'


def search_by_company_name(name, api_key, mode='2', history='0'):
    """商号で法人番号公表サイトを検索する。

    戻り値は法人番号・商号・本店所在地などのリスト。代表者名は含まれない。
    """
    params = {
        'id': api_key,
        'name': name,
        'type': '12',   # レスポンス形式: JSON
        'mode': mode,    # 1=前方一致, 2=部分一致
        'history': history,
    }
    url = f'{API_URL}?{urllib.parse.urlencode(params)}'
    with urllib.request.urlopen(url, timeout=10) as resp:
        body = resp.read().decode('utf-8')
    data = json.loads(body)
    if 'errorInfo' in data:
        raise RuntimeError(data['errorInfo'])
    return data.get('corporations', [])


def format_result(corp):
    address = ''.join(filter(None, [
        corp.get('prefectureName', ''),
        corp.get('cityName', ''),
        corp.get('streetNumber', ''),
    ]))
    return {
        'corporate_number': corp.get('corporateNumber'),
        'name': corp.get('name'),
        'address': address,
        'process': corp.get('process'),
    }


def main():
    parser = argparse.ArgumentParser(
        description='国税庁 法人番号公表サイト Web-API で商号を照会する（照会のみ・自動書き込みなし）'
    )
    parser.add_argument('--name', required=True, help='検索する商号（会社名）')
    parser.add_argument(
        '--api-key',
        default=os.environ.get('HOUJIN_BANGOU_API_KEY'),
        help='Web-API利用申請で取得したアプリケーションID（環境変数 HOUJIN_BANGOU_API_KEY でも指定可）',
    )
    parser.add_argument('--mode', choices=['1', '2'], default='2', help='1=前方一致, 2=部分一致（既定）')
    args = parser.parse_args()

    if not args.api_key:
        print(
            'エラー: APIキー（アプリケーションID）が指定されていません。\n'
            '取得方法: https://www.houjin-bangou.nta.go.jp/webapi/index.html から無料で発行できますが、\n'
            '発行手続きに1〜1.5ヶ月ほどかかることがあります。すぐに使いたい場合は houjin_bangou_csv.py '
            '（申請不要の全件データCSVを使うオフライン照会）を利用してください。\n'
            '取得後は --api-key オプション、または環境変数 HOUJIN_BANGOU_API_KEY で指定できます。',
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        corporations = search_by_company_name(args.name, args.api_key, mode=args.mode)
    except Exception as e:
        print(f'照会に失敗しました: {e}', file=sys.stderr)
        sys.exit(1)

    if not corporations:
        print('該当する法人情報は見つかりませんでした。')
        return

    results = [format_result(c) for c in corporations]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print(
        f'\n{len(results)} 件見つかりました。'
        'このAPIには代表者名が含まれないため、同一代表者の複数企業の自動検出はできません。\n'
        '内容を確認のうえ、必要であれば manager.py --action update_owner / update_shop で'
        '手動反映してください（自動書き込みは行いません）。'
    )


if __name__ == '__main__':
    main()
