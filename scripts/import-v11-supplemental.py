#!/usr/bin/env python3
"""Validate pinned upstream releases and load them through the V11 owner role."""

import argparse
from collections import defaultdict
from contextlib import closing, ExitStack
import csv
from datetime import date
from decimal import Decimal
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sqlite3
import struct
import subprocess
import tempfile
from zipfile import ZipFile

from v11_supplemental_raster import annual_assets, archive_in_s3


CITY_DOI = 'https://doi.org/10.6084/m9.figshare.30338773.v1'
POLICY_DOI = 'https://doi.org/10.6084/m9.figshare.32182515.v1'
GRW_RELEASE = 'https://github.com/microsoft/global-renewables-watch/releases/tag/v1.0'
WRI_URL = 'https://datasets.wri.org/datasets/global-power-plant-database'
GHCN_BASE = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/'
RASTER_DOI = 'https://doi.org/10.6084/m9.figshare.17004523.v1'
ATLAS_DOI = 'https://doi.org/10.7910/DVN/T4CHWJ'

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


def fingerprint(file, expected=None):
    sha256 = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with file.open('rb') as source:
        while block := source.read(1024 * 1024):
            sha256.update(block)
            md5.update(block)
    checksum = md5.hexdigest() if expected and len(expected) == 32 else sha256.hexdigest()
    if expected and checksum != expected:
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


def load_policy_documents(root, writers):
    file = root / 'policies.zip'
    sha = fingerprint(file, '8e625d70df2e80d2a74336e9e47f1d3c')
    metadata = defaultdict(set)
    groups = defaultdict(set)
    classifications = defaultdict(lambda: defaultdict(set))
    bodies = defaultdict(set)
    metadata_keys = ('政策标题', '公布日期', '施行日期', '制定机关')
    label_keys = ('objective_main', 'objective_sub', 'instrument_main', 'instrument_sub')
    with ZipFile(file) as archive:
        for name in archive.namelist():
            parts = name.split('/')
            if len(parts) == 4 and parts[2].startswith('Policy texts_') and name.endswith('.txt'):
                bodies[Path(name).stem].add(name)
                continue
            if not name.endswith('.csv'):
                continue
            _, keyword, filename = parts
            is_metadata = filename.startswith('Policy detailed information list_')
            if not is_metadata and not filename.startswith('Policy objectives and instruments_'):
                continue
            group = (keyword, Path(filename).stem.rsplit('_', 1)[1])
            with archive.open(name) as item, io.TextIOWrapper(item, encoding='utf-8-sig') as stream:
                for row in csv.DictReader(stream):
                    gid = row.pop('gid').strip()
                    if not gid:
                        continue
                    if not re.fullmatch(r'[0-9a-f]+', gid):
                        raise ValueError(f'Invalid policy ID in {name}')
                    groups[gid].add(group)
                    if is_metadata:
                        fields = {key: value.strip() for key, value in row.items()}
                        metadata[gid].add(json.dumps(fields, ensure_ascii=False, sort_keys=True))
                    else:
                        labels = classifications[gid]
                        for key in label_keys:
                            if value := row[key].strip():
                                labels[key].add(value)
    if len(metadata) != 7223 or metadata.keys() != bodies.keys() or len(classifications) != 7221:
        raise ValueError('Policy metadata, labels, and text index differ from the verified v1 archive')
    for gid, variants in sorted(metadata.items()):
        details = [json.loads(value) for value in sorted(variants)]
        identifiers = {tuple(row[key] or None for key in metadata_keys) for row in details}
        if len(identifiers) != 1:
            raise ValueError(f'Conflicting policy identity fields for {gid}')
        labels = {key: sorted(values) for key, values in classifications.get(gid, {}).items()}
        lineage = {'search_groups': sorted(groups[gid]), 'text_members': sorted(bodies[gid])}
        writers['policy_document'].writerow([
            sha, gid, *identifiers.pop(), json.dumps(details, ensure_ascii=False),
            json.dumps(lineage, ensure_ascii=False), json.dumps(labels, ensure_ascii=False),
        ])
    catalog(writers['source'], sha, 'cn_energy_transition_policy_documents', 'v1', '中国能源转型政策逐条元数据与分类',
            ['power', 'carbon', 'economy'], POLICY_DOI, 'CC BY 4.0，导入发布的元数据及分类，正文保留归档定位', len(metadata), {
                'table': 'standard.supplemental_policy_document', 'grain': 'PKULaw gid',
                'classification_groups': label_keys, 'coverage': [2000, 2024],
                'quality': {'missing_classification_id': len(metadata) - len(classifications),
                            'ids_with_nonempty_labels': sum(bool(labels) for labels in classifications.values()),
                            'paper_text_count': 7295},
                'dates': '保留发布与施行日期的原字符串和精度。',
                'source_groups': '保留七个检索词中的所有出现及中央／地方分组、源正文成员路径。',
            })


def read_wdi_response(raw, name):
    header, records = json.loads(raw, parse_float=Decimal)
    if header['page'] != 1 or header['pages'] != 1 or len(records) != header['total']:
        raise ValueError(f'Incomplete World Bank response: {name}')
    return header, records


def load_wdi_emissions(root, writers):
    region_file = (root / 'wdi-regions.json').read_bytes()
    _, regions = read_wdi_response(region_file, 'regions')
    by_iso3 = {item['id']: item for item in regions}
    by_iso2 = {item['iso2Code']: item for item in regions}
    for file_code, label in [('CO2', '二氧化碳'), ('ALL', '全部温室气体')]:
        raw = (root / f'wdi-{file_code}.json').read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        version, records = read_wdi_response(raw, file_code)
        indicator = f'EN.GHG.{file_code}.MT.CE.AR5'
        keys = set()
        kinds = defaultdict(int)
        for row in records:
            iso3 = row['countryiso3code']
            iso2 = row['country']['id']
            key = iso3 or iso2
            region = by_iso3.get(iso3) or by_iso2.get(iso2)
            kind = ('aggregate' if region['region']['id'] == 'NA' else 'economy') if region else 'unmapped'
            year, value = int(row['date']), row['value']
            if row['indicator']['id'] != indicator or (key, year) in keys or not 1970 <= year <= 2024:
                raise ValueError(f'Invalid or duplicate World Bank row: {indicator}/{key}/{year}')
            if value is not None and (not isinstance(value, (Decimal, int)) or not Decimal(value).is_finite()):
                raise ValueError(f'Non-numeric World Bank observation: {indicator}/{key}/{year}')
            keys.add((key, year))
            kinds[kind] += 1
            writers['wdi'].writerow([sha, indicator, key, row['country']['value'], kind, year, value, row['obs_status']])
        if {year for _, year in keys} != set(range(1970, 2025)):
            raise ValueError(f'Incomplete World Bank years for {indicator}')
        catalog(writers['source'], sha, f'wdi_edgar_{file_code.lower()}_excl_lulucf', f'WDI {version["lastupdated"]}',
                f'世界银行 EDGAR 年度{label}排放（不含 LULUCF）', ['carbon'],
                f'https://data.worldbank.org/indicator/{indicator}', 'CC BY 4.0', len(keys), {
                    'table': 'standard.supplemental_wdi_emissions', 'indicator': indicator, 'unit': 'Mt CO₂e',
                    'coverage': [1970, 2024], 'grain': '经济体或地区聚合 × 年', 'quality': dict(kinds),
                    'region_metadata_sha256': hashlib.sha256(region_file).hexdigest(),
                    'missing': '保留源空值，地区聚合与单一经济体加总时分别筛选。',
                })


def load_wri_plants(root, writers):
    file = root / 'wri-v1.3.0.zip'
    sha = fingerprint(file, '59f3e57312a85eec3c281608e5f3c8f993d8fdad5dde179430dca42f2ac6ce99')
    count = 0
    countries = set()
    fields = ('gppd_idnr', 'name', 'country', 'latitude', 'longitude', 'capacity_mw', 'primary_fuel')
    with ZipFile(file) as archive, archive.open('global_power_plant_database.csv') as member:
        for row in csv.DictReader(io.TextIOWrapper(member, encoding='utf-8-sig')):
            plant = [row.pop(key).strip() for key in fields]
            generation = {}
            for year in range(2013, 2020):
                published = row.pop(f'generation_gwh_{year}').strip()
                estimated = row.pop(f'estimated_generation_gwh_{year}', '').strip()
                note = row.pop(f'estimated_generation_note_{year}', '').strip()
                generation[year] = {'reported_gwh': float(published) if published else None,
                                    'estimated_gwh': float(estimated) if estimated else None,
                                    'estimate_method': note or None}
            writers['wri'].writerow([sha, *plant, json.dumps(row, ensure_ascii=False),
                                     json.dumps(generation, allow_nan=False)])
            countries.add(plant[2])
            count += 1
    if count != 34936 or len(countries) != 167:
        raise ValueError(f'Unexpected WRI plant or country count: {count}/{len(countries)}')
    catalog(writers['source'], sha, 'wri_global_power_plant_database', '1.3.0', 'WRI 全球电厂数据库', ['power'],
            WRI_URL, 'CC BY 4.0', count, {
                'table': 'standard.supplemental_wri_plant', 'grain': '电厂', 'crs': 'EPSG:4326',
                'country_codes': len(countries), 'units': {'capacity': 'MW', 'generation': 'GWh'},
                'coverage': {'reported_generation': [2013, 2019], 'estimated_generation': [2013, 2017]},
                'missing': '公开列与估算列独立保存，空值不填零。',
            })


def load_ghcn_china_2024(root, writers):
    data = root / 'ghcnd-2024.csv.gz'
    station_file = root / 'ghcnd-stations.txt'
    sha = fingerprint(data)
    station_sha = fingerprint(station_file)
    stations = {}
    with station_file.open(encoding='utf-8', errors='replace') as source:
        for line in source:
            if line.startswith('CH'):
                station_id = line[:11]
                elevation = Decimal(line[31:37].strip())
                stations[station_id] = (line[41:71].strip(), line[12:20].strip(), line[21:30].strip(),
                                        None if elevation == Decimal('-999.9') else elevation)
    elements = {'TMAX': '0.1 °C', 'TMIN': '0.1 °C', 'PRCP': '0.1 mm', 'SNOW': 'mm'}
    selected = set()
    count = 0
    flagged = 0
    with gzip.open(data, 'rt', encoding='ascii', newline='') as source:
        for row in csv.reader(source):
            if not row[0].startswith('CH') or row[2] not in elements:
                continue
            station, day, element, raw, measurement, quality, source_flag, observation_time = row
            observed_on = date(int(day[:4]), int(day[4:6]), int(day[6:8]))
            if station not in stations or observed_on.year != 2024:
                raise ValueError(f'Unknown GHCN station or unexpected date: {station}/{day}')
            selected.add(station)
            value = None if raw == '-9999' else int(raw)
            writers['ghcn_daily'].writerow([sha, station, observed_on, element, value, measurement, quality,
                                            source_flag, observation_time])
            count += 1
            flagged += bool(quality)
    for station in sorted(selected):
        writers['ghcn_station'].writerow([sha, station, *stations[station]])
    if not selected or not count:
        raise ValueError('No China station records in the GHCN 2024 archive')
    catalog(writers['source'], sha, 'noaa_ghcn_daily_china_2024', 'GHCN-Daily 2024 archive',
            'NOAA GHCN-Daily 中国站点 2024 年日观测', ['meteo'], GHCN_BASE + 'by_year/2024.csv.gz',
            'NOAA GHCN-Daily 公共档案，保留观测来源及质量标记', count, {
                'table': 'standard.supplemental_ghcn_daily', 'crs': '经纬度点位', 'elements': elements,
                'grain': '站点 × 当地观测日 × 要素', 'coverage': [2024], 'station_count': len(selected),
                'quality_flagged': flagged, 'station_sha256': station_sha, 'scope': 'GHCN 站点代码前缀 CH',
                'missing': '原始缺测标记 −9999 转为空，保留质量标记。',
            })


def load_rasters(root, writers, endpoint):
    sources = [
        ('electricity.zip', '9fee79f38045b607a1fc7a2e9e5d3a15', 'power', 'global_electricity_1km',
         'Revised Global Electricity Consumption Grids (1992–2019)', 'kWh / 年 / 像元', 134),
        ('gdp.zip', '6846422176440b2e391aad1241273f33', 'economy', 'global_real_gdp_1km',
         'Revised Global Real GDP Grids (1992–2019)', '百万 2017 年美元 / 年 / 像元', 175),
    ]
    for filename, checksum, topic, dataset, title, unit, economies in sources:
        file = root / filename
        sha = fingerprint(file, checksum)
        assets = annual_assets(file)
        uri = archive_in_s3(endpoint, file, topic, dataset, sha) if endpoint else None
        if uri:
            writers['raster_object'].writerow([uri, sha, file.stat().st_size])
        for asset in assets:
            writers['raster'].writerow([sha, *asset, uri])
        catalog(writers['source'], sha, dataset, 'v1', title, [topic], RASTER_DOI, 'CC BY 4.0', len(assets), {
            'table': 'standard.supplemental_raster_asset', 'coverage': [1992, 2019], 'economies': economies,
            'unit': unit, 'crs': 'World Mollweide', 'resolution_m': [1000, 1000], 'format': 'GeoTIFF',
            'grain': '年度 × 像元', 'identity': 'nighttime_lights_research_estimate',
            'coverage_note': '产品将未覆盖地区编码为零，区域计算需要覆盖掩膜。',
        })


def load_atlas_trade(root, writers):
    releases = [
        ('atlas-hs92-country-product-2.csv', 'b767f3c2dad599ecce2204a4b5ba9fa6', 13685112,
         'country_hs2', 'Harvard Atlas 经济体与 HS 1992 商品章年度贸易', '经济体 × HS 1992 两位商品章 × 年'),
        ('atlas-hs92-country-country.csv', '9c39659168dd5212f745572ba35b2a5c', 13685107,
         'bilateral', 'Harvard Atlas 双边年度商品贸易总额', '报告经济体 × 贸易伙伴 × 年'),
    ]
    for filename, checksum, file_id, kind, title, grain in releases:
        file = root / filename
        sha = fingerprint(file, checksum)
        years = set()
        count = 0
        with file.open(newline='', encoding='utf-8-sig') as source:
            for row in csv.DictReader(source):
                year = int(row['year'])
                years.add(year)
                writers['atlas'].writerow([
                    sha, row['country_iso3_code'], row['country_id'], row.get('partner_iso3_code'),
                    row.get('product_hs92_code'), row.get('partner_country_id') or row['product_id'], year,
                    row['export_value'], row['import_value'], row.get('global_market_share'),
                    row.get('distance'), row.get('cog'), row.get('pci'),
                ])
                count += 1
        if years != set(range(1995, 2025)):
            raise ValueError(f'Unexpected Harvard Atlas reporting period in {filename}')
        catalog(writers['source'], sha, f'harvard_atlas_hs92_{kind}', '18.0', title, ['economy'], ATLAS_DOI,
                'CC0 1.0', count, {
                    'table': 'standard.supplemental_atlas_trade', 'grain': grain, 'coverage': [1995, 2024],
                    'unit': '当年价 USD', 'classification': 'HS 1992',
                    'file': f'https://dataverse.harvard.edu/api/access/datafile/{file_id}',
                    'definitions': 'https://dataverse.harvard.edu/api/access/datafile/13685113',
                    'lookup': 'https://doi.org/10.7910/DVN/3BAL1O',
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
    loaders = {'city': load_city, 'policy': load_policy, 'policy-documents': load_policy_documents,
               'wdi-emissions': load_wdi_emissions, 'wri-plants': load_wri_plants, 'ghcn-cn-2024': load_ghcn_china_2024,
               'atlas-trade': load_atlas_trade}
    parser.add_argument('--dataset', choices=(*loaders, 'wind', 'solar', 'rasters'), action='append', required=True)
    parser.add_argument('--raster-s3-endpoint', help='Store and verify the raster archives through the configured S3 credentials')
    args = parser.parse_args()
    script = Path(__file__).with_name('v11-supplemental-ingest.sql').resolve()
    with tempfile.TemporaryDirectory(prefix='ogw-v11-supplemental-') as scratch:
        directory = Path(scratch)
        with ExitStack() as stack:
            writers = {name: csv.writer(stack.enter_context((directory / f'{name}.csv').open('w', newline='', encoding='utf-8')))
                       for name in ('source', 'city', 'policy', 'policy_document', 'wdi', 'wri',
                                    'ghcn_station', 'ghcn_daily', 'feature', 'raster', 'raster_object', 'atlas')}
            for name in dict.fromkeys(args.dataset):
                if name in loaders:
                    loaders[name](args.source_directory, writers)
                elif name == 'rasters':
                    load_rasters(args.source_directory, writers, args.raster_s3_endpoint)
                else:
                    load_renewables(args.source_directory, writers, name)
        subprocess.run(['psql', '--no-psqlrc', '--file', str(script)], cwd=directory, check=True)


if __name__ == '__main__':
    main()
