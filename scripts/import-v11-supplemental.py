#!/usr/bin/env python3
"""Validate pinned upstream releases and load them through the V11 owner role."""

import argparse
from contextlib import closing, ExitStack
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import struct
import subprocess
import tempfile


CITY_DOI = 'https://doi.org/10.6084/m9.figshare.30338773.v1'
POLICY_DOI = 'https://doi.org/10.6084/m9.figshare.32182515.v1'
GRW_RELEASE = 'https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0'

POLICY_FILES = {
    'national': ('f9f7e9fa0c20e1798e1f5cd4d69b31ac', 22, 64283241),
    'provincial': ('d4ef824da41f0c6074b406abb8fc03d0', 497, 64283253),
    'prefecture': ('ea469c950a56be49ad605f2be97f9456', 1217, 64283250),
}
POLICY_LABELS = {
    'objective': 'env_climate energy_system economic_industrial social_governance',
    'objective_detail': 'ghg_reduction air_pollution ecological_protection energy_structure energy_efficiency '
                        'energy_security power_transformation industrial_upgrading green_industry '
                        'technological_innovation cost_competitiveness green_finance market_development '
                        'institutional_capacity public_participation just_transition',
    'instrument': 'regulatory economic informational',
    'instrument_detail': 'cmd_control standards planning_targets carbon_pricing subsidies fiscal_financial '
                         'info_disclosure labeling public_guidance',
    'subtotal': 'objective_main_sum objective_sub_sum instrument_main_sum instrument_sub_sum',
}
GRW_FILES = {
    'wind': ('c859544f9e04b064880d30d7288aacf9940dc361d576c3ef73565d2f1bb0398a', 375197, 'POINT'),
    'solar': ('9f27c76313fcd78418a7277e4f7526c536887965fd3ef80160ed1d1ceedf947b', 86345, 'POLYGON'),
}


def fingerprint(file, expected):
    sha256 = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with file.open('rb') as source:
        while block := source.read(1024 * 1024):
            sha256.update(block)
            md5.update(block)
    checksum = md5.hexdigest() if len(expected) == 32 else sha256.hexdigest()
    if checksum != expected:
        raise ValueError(f'{file.name} checksum differs from the pinned upstream release')
    return sha256.hexdigest()


def catalog(writer, sha, dataset, version, title, topics, source_url, license_note, count, semantics):
    writer.writerow([sha, dataset, version, title, '{' + ','.join(topics) + '}', source_url,
                     license_note, count, json.dumps(semantics, ensure_ascii=False)])


def load_city(root, writers):
    from openpyxl import load_workbook

    file = root / 'city.xlsx'
    sha = fingerprint(file, '996ef72f77030c6328f513beb624d3c1')
    workbook = load_workbook(file, read_only=True, data_only=True)
    years = set(range(2000, 2020))
    keys = set()
    names = {}
    try:
        rows = iter(workbook['Sheet1'].values)
        expected = ('Administrative division code', 'City', 'Year', 'Power generation: one hundred million kwh',
                    'CO2 emissions from power sector: ten thousand tons')
        if next(rows)[:5] != expected:
            raise ValueError('The city workbook headers or units differ from the pinned release')
        for line, row in enumerate(rows, 2):
            code, name, year, generation, emissions = row[:5]
            code = str(code)
            name = name.strip() if isinstance(name, str) else ''
            if not re.fullmatch(r'[0-9]{6}', code) or not name or year not in years or (code, year) in keys:
                raise ValueError(f'Invalid or duplicate city-year at workbook row {line}')
            if names.setdefault(code, name) != name:
                raise ValueError(f'Inconsistent city label at workbook row {line}')
            for value in (generation, emissions):
                if value is not None and (not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0):
                    raise ValueError(f'Invalid city observation at workbook row {line}')
            keys.add((code, year))
            writers['city'].writerow([sha, code, name, year, generation, emissions, line])
    finally:
        workbook.close()
    if len(names) != 352 or len(keys) != 7040:
        raise ValueError('Expected 352 cities with 20 distinct years each')
    catalog(writers['source'], sha, 'cn_city_power_emissions', 'v1', '中国城市发电量与电力部门 CO₂ 排放估算',
            ['power', 'carbon'], CITY_DOI, 'CC BY 4.0', len(keys), {
                'table': 'standard.supplemental_city_power', 'identity': 'research_estimate',
                'grain': '源行政区划代码 × 自然年', 'coverage': [2000, 2019],
                'metrics': {'generation_100m_kwh': '发电量，亿千瓦时', 'emissions_10kt_co2': '电力部门排放，万吨 CO₂'},
                'method': 'PSO-BP 估算城市发电量，使用 2021 年省级电力排放因子计算历史 CO₂ 排放。',
                'paper': 'https://doi.org/10.1038/s41597-026-07484-w',
                'code': 'https://doi.org/10.6084/m9.figshare.30338803',
                'missing': '空值保留，零保留。',
            })


def load_policy(root, writers):
    import pandas as pd

    labels = {group: columns.split() for group, columns in POLICY_LABELS.items()}
    for level, (checksum, expected, file_id) in POLICY_FILES.items():
        file = root / f'{level}.dta'
        sha = fingerprint(file, checksum)
        table = pd.read_stata(file, convert_categoricals=False)
        if len(table) != expected:
            raise ValueError(f'Unexpected number of region-years in {file.name}')
        counts = 0
        for row in table.itertuples(index=False):
            code = '000000' if level == 'national' else str(row.code)
            name = '全国' if level == 'national' else row.local.strip()
            for columns in labels.values():
                for label in columns:
                    value = getattr(row, label)
                    if not pd.isna(value) and (not math.isfinite(value) or value < 0 or int(value) != value):
                        raise ValueError(f'Invalid count {level}/{code}/{row.year}/{label}')
                    writers['policy'].writerow([sha, level, code, name, row.year, label,
                                               None if pd.isna(value) else int(value)])
                    counts += 1
        catalog(writers['source'], sha, f'cn_energy_transition_policy_{level}', 'v1', '中国能源转型政策年度分类计数',
                ['power', 'carbon', 'economy'], POLICY_DOI, 'CC BY 4.0，使用发布方整理后的分类汇总', counts, {
                    'table': 'standard.supplemental_policy_counts', 'admin_level': level,
                    'grain': '行政层级 × 源地区代码 × 生效年 × 标签', 'labels': labels,
                    'region_years': expected, 'coverage': [int(table.year.min()), int(table.year.max())],
                    'file': f'https://ndownloader.figshare.com/files/{file_id}',
                    'method': '按生效年计数，一份政策可以有多个标签。部分 2024 年发布的政策在 2025 年生效。',
                    'missing': '源中没有地区年度的情况不可视作零。',
                    'review_note': '作者 Stata 脚本的中央汇总段引用部分 local 文件，跨层级统计前需与作者核实。',
                })


def wkb_from_geopackage(blob, srid, geometry_types):
    if not isinstance(blob, bytes) or len(blob) < 13 or blob[:3] != b'GP\x00' or blob[3] & 0xE0:
        raise ValueError('Missing or extended GeoPackage geometry')
    offsets = {0: 8, 1: 40, 2: 56, 3: 56, 4: 72}
    offset = offsets.get((blob[3] >> 1) & 7)
    if offset is None:
        raise ValueError('Invalid GeoPackage envelope flag')
    payload = blob[offset:]
    if struct.unpack_from('<i' if blob[3] & 1 else '>i', blob, 4)[0] != srid:
        raise ValueError('Unexpected geometry SRID')
    if len(payload) < 6 or payload[0] not in (0, 1):
        raise ValueError('Invalid WKB geometry header')
    if struct.unpack_from('<I' if payload[0] else '>I', payload, 1)[0] not in geometry_types:
        raise ValueError('Unexpected WKB geometry type')
    return '\\x' + payload.hex(), bool(blob[3] & 0x10)


def load_renewables(root, writers, tech):
    checksum, expected, expected_type = GRW_FILES[tech]
    file = root / f'{tech}.gpkg'
    sha = fingerprint(file, checksum)
    table = f'{tech}_all_2024q2'
    srid = 3857
    extra_columns = ('local_utm_crs', 'local_utm_x', 'local_utm_y') if tech == 'wind' else ('layer', 'area')
    count = 0
    empty_count = 0
    with closing(sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True)) as source:
        geometry = source.execute('SELECT geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?',
                                  (table,)).fetchone()
        if geometry != (expected_type, srid):
            raise ValueError(f'Unexpected geometry declaration in {file.name}: {geometry}')
        for fid, geom, year, quarter, country, cover, *extra in source.execute(
                f'SELECT fid, geom, construction_year, construction_quarter, COUNTRY, landcover_in_2018, '
                f'{", ".join(extra_columns)} FROM {table}'):
            if year is None or quarter is None or int(year) != year or int(quarter) != quarter:
                raise ValueError(f'Invalid estimated quarter for {tech}/{fid}')
            wkb, is_empty = wkb_from_geopackage(geom, srid, {1} if tech == 'wind' else {3})
            attributes = json.dumps(dict(zip(extra_columns, extra, strict=True)), ensure_ascii=False, allow_nan=False)
            writers['feature'].writerow([sha, fid, tech, int(year), int(quarter), country, cover, wkb, srid, is_empty, attributes])
            count += 1
            empty_count += is_empty
    if count != expected:
        raise ValueError(f'Expected {expected} {tech} geometries, received {count}')
    catalog(writers['source'], sha, f'global_renewables_watch_{tech}', 'v1.0-2024q2',
            f'全球可再生能源观测 · {"陆上风机" if tech == "wind" else "商业光伏场"}', ['power'], GRW_RELEASE,
            'GitHub 发布数据，正式对外分发前复核数据授权', count, {
                'table': 'standard.supplemental_renewable_feature', 'identity': 'satellite_model_detection',
                'grain': '单台风机' if tech == 'wind' else '单处光伏场',
                'coverage': ['2017Q4', '2024Q2'], 'geometry_type': expected_type, 'crs': 'EPSG:3857',
                'method': '卫星影像识别与建设季度估算。2017Q4 是序列起点，可能含此前建成设施。',
                'limitations': '设施数量与几何无法直接推导实际装机容量或发电量，保留发布方的国家标签。',
                'count_note': '以发布附件实际要素为准。项目 README 的光伏数量为 86410。' if tech == 'solar' else '与项目 README 一致。',
                'quality': {'empty_geometry_rows': empty_count, 'nonempty_geometry_rows': count - empty_count},
                'source_attributes': extra_columns,
            })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_directory', type=Path)
    parser.add_argument('--dataset', choices=('city', 'policy', 'wind', 'solar'), action='append', required=True)
    args = parser.parse_args()
    script = Path(__file__).with_name('v11-supplemental-ingest.sql').resolve()
    with tempfile.TemporaryDirectory(prefix='ogw-v11-supplemental-') as scratch:
        directory = Path(scratch)
        with ExitStack() as stack:
            writers = {name: csv.writer(stack.enter_context((directory / f'{name}.csv').open('w', newline='', encoding='utf-8')))
                       for name in ('source', 'city', 'policy', 'feature')}
            for name in dict.fromkeys(args.dataset):
                if name == 'city':
                    load_city(args.source_directory, writers)
                elif name == 'policy':
                    load_policy(args.source_directory, writers)
                else:
                    load_renewables(args.source_directory, writers, name)
        subprocess.run(['psql', '--no-psqlrc', '--file', str(script)], cwd=directory, check=True)


if __name__ == '__main__':
    main()
