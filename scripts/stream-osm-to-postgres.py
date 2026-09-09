"""Restore complete real OSM layers without loading giant GeoJSONs in memory."""
import hashlib
import json
import os
from pathlib import Path
import ijson
import psycopg2
from psycopg2.extras import execute_values, Json

repo = Path(__file__).resolve().parent.parent
expected = {"china-power-lines.geojson": 199001, "china-power-substations.geojson": 37069,
            "china-power-plants.geojson": 14644, "china-power-generators.geojson": 753493}
connection = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="disable", connect_timeout=15)
try:
    for name, expected_count in expected.items():
        file = repo / "public" / "data" / "osm-power" / name
        source = file.relative_to(repo.parent).as_posix()
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        with connection.cursor() as cursor:
            cursor.execute("SELECT sha256 FROM website_data.source_files WHERE path=%s", (source,))
            saved = cursor.fetchone()
            if not saved or saved[0] != digest.hexdigest():
                raise RuntimeError(f"Source hash does not match catalog: {name}")
            cursor.execute("SELECT count(*) FROM website_data.geo_features WHERE source_path=%s", (source,))
            existing = cursor.fetchone()[0]
            if existing:
                if existing != expected_count:
                    raise RuntimeError(f"Existing layer count differs; refusing overwrite: {name}")
                print(f"Verified existing {name}: {existing}", flush=True)
                connection.rollback()
                continue
            batch, count = [], 0
            def flush():
                if batch:
                    execute_values(cursor, """INSERT INTO website_data.geo_features
                      (source_path,feature_index,dataset,feature_id,geometry_type,geometry,properties)
                      VALUES %s""", batch, page_size=1000)
                    batch.clear()
            with file.open("rb") as stream:
                for feature in ijson.items(stream, "features.item", use_float=True):
                    geometry = feature.get("geometry")
                    batch.append((source, count, "osm-power", str(feature["id"]) if "id" in feature else None,
                                  geometry.get("type") if geometry else None,
                                  Json(geometry), Json(feature.get("properties") or {})))
                    count += 1
                    if len(batch) >= 1000:
                        flush()
                    if count % 50000 == 0:
                        print(f"{name}: {count}/{expected_count}", flush=True)
            flush()
            if count != expected_count:
                raise RuntimeError(f"Source count changed: {name}: {count} != {expected_count}")
            cursor.execute("SELECT count(*) FROM website_data.geo_features WHERE source_path=%s", (source,))
            if cursor.fetchone()[0] != count:
                raise RuntimeError(f"Database count mismatch: {name}")
            cursor.execute("UPDATE website_data.source_files SET import_status='imported', record_count=%s, error=NULL, imported_at=now() WHERE path=%s", (count, source))
        connection.commit()
        print(f"Committed and verified {name}: {count}", flush=True)
except Exception:
    connection.rollback()
    raise
finally:
    connection.close()
