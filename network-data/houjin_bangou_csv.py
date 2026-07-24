#!/usr/bin/env python3
"""国税庁 法人番号公表サイトの「全件データ」CSV（申請不要・即時ダウンロード）を読み込むモジュール

ダウンロード元: https://www.houjin-bangou.nta.go.jp/download/zenken/
（都道府県別に選択してダウンロード。アプリケーションID等の申請は不要）

ファイル形式は以下の固定列（ヘッダー行なし）。文字コードはUTF-8またはShift-JIS。
  列0: 一連番号
  列1: 法人番号
  列6: 商号又は名称
  列9: 都道府県名
  列10: 市区町村名
  列11: 丁目番地等
（Web-APIのJSONレスポンスと同じ項目のため、houjin_bangou_api.pyのformat_result()と互換の
  辞書形式で返す）
"""

import csv


def load_corporate_index(csv_path):
    """CSVを読み込み、{商号: [corp_dict, ...]} のインデックスを返す。

    同名の法人が複数存在する場合に備えてリストで保持する。
    """
    rows = None
    last_error = None
    for encoding in ('utf-8-sig', 'utf-8', 'cp932'):
        try:
            with open(csv_path, encoding=encoding, newline='') as f:
                rows = list(csv.reader(f))
            break
        except UnicodeDecodeError as e:
            last_error = e
            continue
    if rows is None:
        raise RuntimeError(f'{csv_path} の文字コードを判別できませんでした（utf-8/cp932とも失敗）: {last_error}')

    index = {}
    for row in rows:
        if len(row) < 12:
            continue
        name = row[6].strip()
        if not name:
            continue
        corp = {
            'corporateNumber': row[1].strip(),
            'name': name,
            'prefectureName': row[9].strip(),
            'cityName': row[10].strip(),
            'streetNumber': row[11].strip(),
        }
        index.setdefault(name, []).append(corp)
    return index


def search_offline(index, query):
    """名称で検索する。完全一致を優先し、無ければ部分一致（表記ゆれ対策）で探す。"""
    if query in index:
        return index[query]
    matches = []
    for name, entries in index.items():
        if query in name or name in query:
            matches.extend(entries)
    return matches
