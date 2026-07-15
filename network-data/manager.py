#!/usr/bin/env python3
"""飲食店ネットワーク相関図 - データ管理CLI"""

import argparse
import json
import sys
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path

VALID_SOURCES = {'manual', 'web', 'lcdb'}
VALID_CONFIDENCE = {'sure', 'medium', 'low'}
VALID_RELATION_TYPES = {'same_building', 'family', 'business', 'other'}


class NetworkManager:
    def __init__(self, data_file='data/network.json'):
        self.data_file = Path(data_file)
        self.load_data()

    # ------------------------------------------------------------------
    # persistence
    # ------------------------------------------------------------------
    def load_data(self):
        if self.data_file.exists():
            with open(self.data_file, encoding='utf-8') as f:
                self.data = json.load(f)
        else:
            self.data = self._init_data()

    def _init_data(self):
        return {
            'metadata': {
                'updated_at': datetime.now().isoformat(),
                'area': 'Chiba',
                'version': '1.0',
            },
            'owners': [],
            'shops': [],
            'relations': [],
        }

    def save_data(self):
        self.data['metadata']['updated_at'] = datetime.now().isoformat()
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.data_file, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _find_owner(self, owner_id):
        return next((o for o in self.data['owners'] if o['id'] == owner_id), None)

    def _find_shop(self, shop_id):
        return next((s for s in self.data['shops'] if s['id'] == shop_id), None)

    def _find_relation(self, relation_id):
        return next((r for r in self.data['relations'] if r['id'] == relation_id), None)

    def _node_exists(self, node_id):
        return self._find_owner(node_id) is not None or self._find_shop(node_id) is not None

    def _check_common_fields(self, name, area, source, confidence):
        if not name or not str(name).strip():
            raise ValueError('name is required')
        if not area or not str(area).strip():
            raise ValueError('area is required')
        if source not in VALID_SOURCES:
            raise ValueError(f'invalid source: {source} (must be one of {sorted(VALID_SOURCES)})')
        if confidence not in VALID_CONFIDENCE:
            raise ValueError(f'invalid confidence: {confidence} (must be one of {sorted(VALID_CONFIDENCE)})')

    # ------------------------------------------------------------------
    # owners: CRUD
    # ------------------------------------------------------------------
    def add_owner(self, name, area, group='', note='', source='manual', confidence='sure'):
        self._check_common_fields(name, area, source, confidence)
        owner = {
            'id': f'owner_{uuid.uuid4().hex[:8]}',
            'name': name,
            'area': area,
            'group': group or '',
            'note': note or '',
            'source': source,
            'confidence': confidence,
        }
        self.data['owners'].append(owner)
        self.save_data()
        return owner['id']

    def list_owners(self, area=None, group=None):
        owners = self.data['owners']
        if area:
            owners = [o for o in owners if o.get('area') == area]
        if group:
            owners = [o for o in owners if o.get('group') == group]
        return owners

    def update_owner(self, owner_id, **fields):
        owner = self._find_owner(owner_id)
        if owner is None:
            raise ValueError(f'Owner {owner_id} not found')
        updates = {k: v for k, v in fields.items() if v is not None}
        merged = {**owner, **updates}
        self._check_common_fields(merged['name'], merged['area'], merged['source'], merged['confidence'])
        owner.update(updates)
        self.save_data()
        return owner

    def delete_owner(self, owner_id, cascade=False):
        owner = self._find_owner(owner_id)
        if owner is None:
            raise ValueError(f'Owner {owner_id} not found')
        dependent_shops = [s for s in self.data['shops'] if s.get('owner_id') == owner_id]
        if dependent_shops and not cascade:
            shop_ids = ', '.join(s['id'] for s in dependent_shops)
            raise ValueError(
                f'Owner {owner_id} still has shops referencing it ({shop_ids}). '
                'Delete those shops first or pass cascade=True.'
            )
        for shop in dependent_shops:
            self.delete_shop(shop['id'], _save=False)
        self.data['relations'] = [
            r for r in self.data['relations']
            if r['from_id'] != owner_id and r['to_id'] != owner_id
        ]
        self.data['owners'] = [o for o in self.data['owners'] if o['id'] != owner_id]
        self.save_data()

    # ------------------------------------------------------------------
    # shops: CRUD
    # ------------------------------------------------------------------
    def add_shop(self, name, area, owner_id, genre='', group='', address='',
                 source='manual', confidence='sure', tabelog_url='', **kwargs):
        self._check_common_fields(name, area, source, confidence)
        if not self._find_owner(owner_id):
            raise ValueError(f'Owner {owner_id} not found')
        shop = {
            'id': f'shop_{uuid.uuid4().hex[:8]}',
            'name': name,
            'genre': genre or '',
            'owner_id': owner_id,
            'area': area,
            'group': group or '',
            'address': address or '',
            'source': source,
            'confidence': confidence,
            'tabelog_url': tabelog_url or '',
        }
        shop.update({k: v for k, v in kwargs.items() if v is not None})
        self.data['shops'].append(shop)
        self.save_data()
        return shop['id']

    def list_shops(self, area=None, genre=None, owner_id=None, group=None):
        shops = self.data['shops']
        if area:
            shops = [s for s in shops if s.get('area') == area]
        if genre:
            shops = [s for s in shops if s.get('genre') == genre]
        if owner_id:
            shops = [s for s in shops if s.get('owner_id') == owner_id]
        if group:
            shops = [s for s in shops if s.get('group') == group]
        return shops

    def update_shop(self, shop_id, **fields):
        shop = self._find_shop(shop_id)
        if shop is None:
            raise ValueError(f'Shop {shop_id} not found')
        updates = {k: v for k, v in fields.items() if v is not None}
        if 'owner_id' in updates and not self._find_owner(updates['owner_id']):
            raise ValueError(f"Owner {updates['owner_id']} not found")
        merged = {**shop, **updates}
        self._check_common_fields(merged['name'], merged['area'], merged['source'], merged['confidence'])
        shop.update(updates)
        self.save_data()
        return shop

    def delete_shop(self, shop_id, _save=True):
        shop = self._find_shop(shop_id)
        if shop is None:
            raise ValueError(f'Shop {shop_id} not found')
        self.data['relations'] = [
            r for r in self.data['relations']
            if r['from_id'] != shop_id and r['to_id'] != shop_id
        ]
        self.data['shops'] = [s for s in self.data['shops'] if s['id'] != shop_id]
        if _save:
            self.save_data()

    # ------------------------------------------------------------------
    # relations: CRUD
    # ------------------------------------------------------------------
    def add_relation(self, from_id, to_id, rel_type, note='', source='manual', confidence='sure'):
        if from_id == to_id:
            raise ValueError('from_id and to_id must not be the same node')
        if not self._node_exists(from_id):
            raise ValueError(f'Node {from_id} not found')
        if not self._node_exists(to_id):
            raise ValueError(f'Node {to_id} not found')
        if rel_type not in VALID_RELATION_TYPES:
            raise ValueError(f'invalid type: {rel_type} (must be one of {sorted(VALID_RELATION_TYPES)})')
        if source not in VALID_SOURCES:
            raise ValueError(f'invalid source: {source}')
        if confidence not in VALID_CONFIDENCE:
            raise ValueError(f'invalid confidence: {confidence}')

        existing = [
            r for r in self.data['relations']
            if {r['from_id'], r['to_id']} == {from_id, to_id}
        ]
        if existing:
            raise ValueError('This relation already exists')

        relation = {
            'id': f'rel_{uuid.uuid4().hex[:8]}',
            'from_id': from_id,
            'to_id': to_id,
            'type': rel_type,
            'note': note or '',
            'source': source,
            'confidence': confidence,
        }
        self.data['relations'].append(relation)
        self.save_data()
        return relation['id']

    def list_relations(self, node_id=None, rel_type=None):
        relations = self.data['relations']
        if node_id:
            relations = [r for r in relations if r['from_id'] == node_id or r['to_id'] == node_id]
        if rel_type:
            relations = [r for r in relations if r['type'] == rel_type]
        return relations

    def update_relation(self, relation_id, **fields):
        relation = self._find_relation(relation_id)
        if relation is None:
            raise ValueError(f'Relation {relation_id} not found')
        updates = {k: v for k, v in fields.items() if v is not None}
        if 'type' in updates and updates['type'] not in VALID_RELATION_TYPES:
            raise ValueError(f"invalid type: {updates['type']}")
        if 'source' in updates and updates['source'] not in VALID_SOURCES:
            raise ValueError(f"invalid source: {updates['source']}")
        if 'confidence' in updates and updates['confidence'] not in VALID_CONFIDENCE:
            raise ValueError(f"invalid confidence: {updates['confidence']}")
        relation.update(updates)
        self.save_data()
        return relation

    def delete_relation(self, relation_id):
        if self._find_relation(relation_id) is None:
            raise ValueError(f'Relation {relation_id} not found')
        self.data['relations'] = [r for r in self.data['relations'] if r['id'] != relation_id]
        self.save_data()

    # ------------------------------------------------------------------
    # validation
    # ------------------------------------------------------------------
    def validate(self):
        errors = []
        warnings = []

        owner_ids = [o['id'] for o in self.data['owners']]
        shop_ids = [s['id'] for s in self.data['shops']]
        relation_ids = [r['id'] for r in self.data['relations']]

        for label, ids in (('owner', owner_ids), ('shop', shop_ids), ('relation', relation_ids)):
            dupes = {i for i, c in Counter(ids).items() if c > 1}
            for d in dupes:
                errors.append(f'duplicate {label} id: {d}')

        node_ids = set(owner_ids) | set(shop_ids)

        for o in self.data['owners']:
            if not o.get('name', '').strip():
                errors.append(f"owner {o.get('id')}: name is empty")
            if not o.get('area', '').strip():
                errors.append(f"owner {o.get('id')}: area is empty")
            if o.get('source') not in VALID_SOURCES:
                errors.append(f"owner {o.get('id')}: invalid source '{o.get('source')}'")
            if o.get('confidence') not in VALID_CONFIDENCE:
                errors.append(f"owner {o.get('id')}: invalid confidence '{o.get('confidence')}'")
            elif o.get('confidence') == 'sure' and o.get('source') in ('web', 'lcdb'):
                warnings.append(
                    f"owner {o.get('id')}: confidence is 'sure' but source is '{o.get('source')}' - please verify"
                )

        for s in self.data['shops']:
            if not s.get('name', '').strip():
                errors.append(f"shop {s.get('id')}: name is empty")
            if not s.get('area', '').strip():
                errors.append(f"shop {s.get('id')}: area is empty")
            if s.get('owner_id') not in owner_ids:
                errors.append(f"shop {s.get('id')}: owner_id '{s.get('owner_id')}' does not exist")
            if s.get('source') not in VALID_SOURCES:
                errors.append(f"shop {s.get('id')}: invalid source '{s.get('source')}'")
            if s.get('confidence') not in VALID_CONFIDENCE:
                errors.append(f"shop {s.get('id')}: invalid confidence '{s.get('confidence')}'")
            elif s.get('confidence') == 'sure' and s.get('source') in ('web', 'lcdb'):
                warnings.append(
                    f"shop {s.get('id')}: confidence is 'sure' but source is '{s.get('source')}' - please verify"
                )

        seen_pairs = {}
        for r in self.data['relations']:
            if r.get('from_id') == r.get('to_id'):
                errors.append(f"relation {r.get('id')}: from_id equals to_id ({r.get('from_id')})")
            if r.get('from_id') not in node_ids:
                errors.append(f"relation {r.get('id')}: from_id '{r.get('from_id')}' does not exist")
            if r.get('to_id') not in node_ids:
                errors.append(f"relation {r.get('id')}: to_id '{r.get('to_id')}' does not exist")
            if r.get('type') not in VALID_RELATION_TYPES:
                errors.append(f"relation {r.get('id')}: invalid type '{r.get('type')}'")
            if r.get('source') not in VALID_SOURCES:
                errors.append(f"relation {r.get('id')}: invalid source '{r.get('source')}'")
            if r.get('confidence') not in VALID_CONFIDENCE:
                errors.append(f"relation {r.get('id')}: invalid confidence '{r.get('confidence')}'")
            pair = frozenset({r.get('from_id'), r.get('to_id')})
            if pair in seen_pairs:
                errors.append(
                    f"relation {r.get('id')}: duplicate relation with {seen_pairs[pair]} "
                    f"({r.get('from_id')} <-> {r.get('to_id')})"
                )
            else:
                seen_pairs[pair] = r.get('id')

        return {'errors': errors, 'warnings': warnings, 'ok': len(errors) == 0}

    # ------------------------------------------------------------------
    # import / export / stats
    # ------------------------------------------------------------------
    def import_from_json(self, path):
        with open(path, encoding='utf-8') as f:
            incoming = json.load(f)

        added = {'owners': 0, 'shops': 0, 'relations': 0}
        skipped = {'owners': 0, 'shops': 0, 'relations': 0}

        existing_owner_ids = {o['id'] for o in self.data['owners']}
        for o in incoming.get('owners', []):
            if o['id'] in existing_owner_ids:
                skipped['owners'] += 1
                continue
            self.data['owners'].append(o)
            existing_owner_ids.add(o['id'])
            added['owners'] += 1

        existing_shop_ids = {s['id'] for s in self.data['shops']}
        for s in incoming.get('shops', []):
            if s['id'] in existing_shop_ids:
                skipped['shops'] += 1
                continue
            self.data['shops'].append(s)
            existing_shop_ids.add(s['id'])
            added['shops'] += 1

        existing_relation_ids = {r['id'] for r in self.data['relations']}
        for r in incoming.get('relations', []):
            if r['id'] in existing_relation_ids:
                skipped['relations'] += 1
                continue
            self.data['relations'].append(r)
            existing_relation_ids.add(r['id'])
            added['relations'] += 1

        self.save_data()
        return {'added': added, 'skipped': skipped}

    def export(self):
        return self.data

    def export_for_html(self):
        nodes = []
        for o in self.data['owners']:
            nodes.append({
                'id': o['id'],
                'label': o['name'],
                'node_type': 'owner',
                'area': o.get('area', ''),
                'group': o.get('group', ''),
                'confidence': o.get('confidence', ''),
            })
        for s in self.data['shops']:
            nodes.append({
                'id': s['id'],
                'label': s['name'],
                'node_type': 'shop',
                'genre': s.get('genre', ''),
                'area': s.get('area', ''),
                'group': s.get('group', ''),
                'confidence': s.get('confidence', ''),
            })

        edges = []
        for s in self.data['shops']:
            edges.append({
                'from_id': s['owner_id'],
                'to_id': s['id'],
                'type': 'owner_shop',
                'confidence': s.get('confidence', ''),
            })
        for r in self.data['relations']:
            edges.append({
                'from_id': r['from_id'],
                'to_id': r['to_id'],
                'type': r['type'],
                'confidence': r.get('confidence', ''),
            })

        return {
            'metadata': self.data['metadata'],
            'nodes': nodes,
            'edges': edges,
        }

    def stats(self):
        owners = self.data['owners']
        shops = self.data['shops']
        relations = self.data['relations']
        return {
            'owner_count': len(owners),
            'shop_count': len(shops),
            'relation_count': len(relations),
            'owners_by_area': dict(Counter(o.get('area', '') for o in owners)),
            'shops_by_area': dict(Counter(s.get('area', '') for s in shops)),
            'shops_by_genre': dict(Counter(s.get('genre', '') for s in shops)),
            'relations_by_type': dict(Counter(r.get('type', '') for r in relations)),
        }


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------
def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _apply_filter(items, filter_str):
    if not filter_str:
        return items
    result = items
    for clause in filter_str.split(','):
        if ':' not in clause:
            continue
        key, _, value = clause.partition(':')
        key, value = key.strip(), value.strip()
        result = [item for item in result if str(item.get(key, '')) == value]
    return result


def build_parser():
    parser = argparse.ArgumentParser(description='飲食店ネットワーク相関図データ管理')
    parser.add_argument('--action', required=True, help='実行するアクション')
    parser.add_argument('--data-file', default='data/network.json', help='データファイルのパス')

    parser.add_argument('--id')
    parser.add_argument('--name')
    parser.add_argument('--area')
    parser.add_argument('--group')
    parser.add_argument('--note')
    parser.add_argument('--genre')
    parser.add_argument('--owner', dest='owner_id')
    parser.add_argument('--address')
    parser.add_argument('--tabelog-url', dest='tabelog_url')
    parser.add_argument('--source', default='manual')
    parser.add_argument('--confidence', default='sure')
    parser.add_argument('--from', dest='from_id')
    parser.add_argument('--to', dest='to_id')
    parser.add_argument('--type', dest='type_')
    parser.add_argument('--filter')
    parser.add_argument('--file')
    parser.add_argument('--output')
    parser.add_argument('--cascade', action='store_true')
    return parser


def main():
    args = build_parser().parse_args()
    mgr = NetworkManager(args.data_file)

    try:
        if args.action == 'add_owner':
            owner_id = mgr.add_owner(args.name, args.area, args.group or '', args.note or '',
                                      args.source, args.confidence)
            print(f'Added owner: {owner_id}')

        elif args.action == 'add_shop':
            shop_id = mgr.add_shop(args.name, args.area, args.owner_id, args.genre or '',
                                    args.group or '', args.address or '', args.source,
                                    args.confidence, args.tabelog_url or '')
            print(f'Added shop: {shop_id}')

        elif args.action == 'add_relation':
            relation_id = mgr.add_relation(args.from_id, args.to_id, args.type_, args.note or '',
                                            args.source, args.confidence)
            print(f'Added relation: {relation_id}')

        elif args.action == 'list':
            target = args.type_ or 'owners'
            if target == 'owners':
                items = mgr.list_owners(area=args.area, group=args.group)
            elif target == 'shops':
                items = mgr.list_shops(area=args.area, genre=args.genre,
                                        owner_id=args.owner_id, group=args.group)
            elif target == 'relations':
                items = mgr.list_relations(node_id=args.id, rel_type=None)
            else:
                raise ValueError(f'unknown list target: {target}')
            items = _apply_filter(items, args.filter)
            _print_json(items)

        elif args.action == 'update_owner':
            fields = dict(name=args.name, area=args.area, group=args.group, note=args.note,
                           source=args.source if args.source != 'manual' else None,
                           confidence=args.confidence if args.confidence != 'sure' else None)
            owner = mgr.update_owner(args.id, **fields)
            print(f"Updated owner: {owner['id']}")

        elif args.action == 'update_shop':
            fields = dict(name=args.name, area=args.area, genre=args.genre, group=args.group,
                           address=args.address, owner_id=args.owner_id,
                           tabelog_url=args.tabelog_url,
                           source=args.source if args.source != 'manual' else None,
                           confidence=args.confidence if args.confidence != 'sure' else None)
            shop = mgr.update_shop(args.id, **fields)
            print(f"Updated shop: {shop['id']}")

        elif args.action == 'update_relation':
            fields = dict(type=args.type_, note=args.note,
                           source=args.source if args.source != 'manual' else None,
                           confidence=args.confidence if args.confidence != 'sure' else None)
            relation = mgr.update_relation(args.id, **fields)
            print(f"Updated relation: {relation['id']}")

        elif args.action == 'delete_owner':
            mgr.delete_owner(args.id, cascade=args.cascade)
            print(f'Deleted owner: {args.id}')

        elif args.action == 'delete_shop':
            mgr.delete_shop(args.id)
            print(f'Deleted shop: {args.id}')

        elif args.action == 'delete_relation':
            mgr.delete_relation(args.id)
            print(f'Deleted relation: {args.id}')

        elif args.action == 'validate':
            result = mgr.validate()
            _print_json(result)
            if not result['ok']:
                sys.exit(1)

        elif args.action == 'import':
            if not args.file:
                raise ValueError('--file is required for import')
            result = mgr.import_from_json(args.file)
            _print_json(result)

        elif args.action == 'export':
            data = mgr.export()
            if args.output:
                Path(args.output).write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8'
                )
                print(f'Exported to {args.output}')
            else:
                _print_json(data)

        elif args.action == 'export_for_html':
            data = mgr.export_for_html()
            if args.output:
                Path(args.output).write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8'
                )
                print(f'Exported to {args.output}')
            else:
                _print_json(data)

        elif args.action == 'stats':
            _print_json(mgr.stats())

        else:
            print(f'Unknown action: {args.action}', file=sys.stderr)
            sys.exit(1)

    except ValueError as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
