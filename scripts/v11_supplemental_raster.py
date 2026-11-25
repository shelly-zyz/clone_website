"""Inspect Figshare annual GeoTIFF archives and optionally store the verified source."""

from contextlib import closing
import hashlib
import math
from pathlib import PurePosixPath
import re
import struct
from tempfile import TemporaryFile
from zipfile import ZipFile


def geotiff_metadata(stream):
    header = stream.read(16)
    endian = {b'II': '<', b'MM': '>'}.get(header[:2])
    if not endian or len(header) != 16:
        raise ValueError('Invalid GeoTIFF header')
    magic = struct.unpack_from(endian + 'H', header, 2)[0]
    if magic == 43 and struct.unpack_from(endian + 'HH', header, 4) == (8, 0):
        offset = struct.unpack_from(endian + 'Q', header, 8)[0]
        count_format, entry_format, inline_pos, inline_size = 'Q', 'HHQQ', 12, 8
    elif magic == 42:
        offset = struct.unpack_from(endian + 'I', header, 4)[0]
        count_format, entry_format, inline_pos, inline_size = 'H', 'HHII', 8, 4
    else:
        raise ValueError('Unsupported TIFF format')
    if not 8 <= offset <= 16 * 1024 * 1024:
        raise ValueError('Unexpected GeoTIFF directory offset')
    stream.seek(offset)
    entries = struct.unpack(endian + count_format, stream.read(struct.calcsize(count_format)))[0]
    if not 1 <= entries <= 1024:
        raise ValueError('Unexpected GeoTIFF directory length')
    selected = {256, 257, 258, 339, 33550, 33922, 34737, 42113}
    fields = {}
    entry_length = struct.calcsize(endian + entry_format)
    for _ in range(entries):
        entry = stream.read(entry_length)
        tag, kind, count, value_offset = struct.unpack(endian + entry_format, entry)
        if tag in selected:
            fields[tag] = entry[inline_pos:], kind, count, value_offset

    def read_field(tag):
        inline, kind, count, value_offset = fields[tag]
        code = {2: 's', 3: 'H', 4: 'I', 12: 'd', 16: 'Q'}[kind]
        length = struct.calcsize(code) * count
        if length > 16 * 1024 or (length > inline_size and value_offset > 16 * 1024 * 1024):
            raise ValueError(f'Unexpected GeoTIFF field size or offset: {tag}')
        if length > inline_size:
            stream.seek(value_offset)
            payload = stream.read(length)
        else:
            payload = inline[:length]
        return struct.unpack(f'{endian}{count}{code}', payload)

    width, height = read_field(256)[0], read_field(257)[0]
    x_size, y_size, _ = read_field(33550)
    projection = read_field(34737)[0].decode('ascii').rstrip('\0')
    if 'PROJECTION["Mollweide"]' not in projection or (x_size, y_size) != (1000, 1000):
        raise ValueError('Unexpected raster projection or pixel size')
    if read_field(258) != (32,) or read_field(339) != (3,):
        raise ValueError('Expected a 32-bit floating point raster')
    nodata = float(read_field(42113)[0].rstrip(b'\0'))
    if width <= 0 or height <= 0 or not math.isfinite(nodata):
        raise ValueError('Invalid raster dimensions or NoData value')
    return width, height, x_size, y_size, nodata, projection


def annual_assets(path):
    assets = {}
    with ZipFile(path) as outer:
        for item in outer.infolist():
            if item.is_dir():
                continue
            matched = re.fullmatch(r'(19\d{2}|20\d{2})\.zip', PurePosixPath(item.filename).name)
            if not matched or int(matched[1]) in assets:
                raise ValueError(f'Unexpected annual raster archive: {item.filename}')
            year = int(matched[1])
            with outer.open(item) as member, TemporaryFile() as annual:
                digest = hashlib.sha256()
                while block := member.read(1024 * 1024):
                    digest.update(block)
                    annual.write(block)
                with ZipFile(annual) as inner:
                    rasters = [name for name in inner.namelist() if name.lower().endswith('.tif')]
                    if len(rasters) != 1:
                        raise ValueError(f'Expected one GeoTIFF in {item.filename}')
                    with inner.open(rasters[0]) as raster:
                        metadata = geotiff_metadata(raster)
            assets[year] = [year, item.filename, rasters[0], item.file_size, digest.hexdigest(), *metadata]
    if set(assets) != set(range(1992, 2020)):
        raise ValueError('The raster file must contain one annual package for each year from 1992–2019')
    return [assets[year] for year in sorted(assets)]


def archive_in_s3(endpoint, path, topic, dataset, digest):
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    client = boto3.client('s3', endpoint_url=endpoint, config=Config(s3={'addressing_style': 'path'}))
    bucket = 'raw'
    key = f'{topic}/{dataset}/{digest}/{path.name}'
    try:
        client.head_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
            raise
        client.upload_file(str(path), bucket, key, ExtraArgs={'ContentType': 'application/zip',
                                                             'Metadata': {'sha256': digest}})
    result = client.get_object(Bucket=bucket, Key=key)
    with closing(result['Body']) as body:
        actual = hashlib.sha256()
        while block := body.read(1024 * 1024):
            actual.update(block)
    if (result['ContentLength'] != path.stat().st_size or result['ContentType'] != 'application/zip'
            or result['Metadata'].get('sha256') != digest or actual.hexdigest() != digest):
        raise ValueError(f'Object verification failed: {key}')
    return f's3://{bucket}/{key}'
