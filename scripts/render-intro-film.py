#!/usr/bin/env python3
"""Render the homepage MP4 and poster from a GRACED Power file and NASA GIBS tiles.

Requires h5py, numpy, Pillow and ffmpeg. Cache the 64 JPEG tiles from the
workspace's VIIRS_CityLights_2012 layer at zoom 3 as <x>-<y>.jpg.
"""

import argparse
from collections import defaultdict
from datetime import date
from pathlib import Path
import subprocess

import h5py
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


SIZE = 960
FPS = 24
DURATION = 12
RADIUS = SIZE * 0.447
CENTER = SIZE / 2
SAMPLE_DATE = date(2025, 8, 15)
BIN_SIZE = 6
BACKGROUND = (4, 9, 15)


def decode(value):
    return value.decode() if isinstance(value, bytes) else str(value)


def load_sample(path):
    with h5py.File(path, "r") as source:
        time = source["nday"]
        units = decode(time.attrs["units"])
        if not units.startswith("days since "):
            raise ValueError(f"Unexpected GRACED time units: {units}")
        offset = (SAMPLE_DATE - date.fromisoformat(units[11:21])).days
        day_indices = np.flatnonzero(time[:] == offset)
        if day_indices.size != 1 or decode(source.attrs["unit"]).replace(" ", "") != "kgC/h":
            raise ValueError("Expected the fixed GRACED daily frame in kgC/h.")
        frame = source["emission"][int(day_indices[0])]
        lons, lats = source["longitude"][:], source["latitude"][:]

    bins = defaultdict(list)
    for row, col in zip(*np.nonzero(np.isfinite(frame) & (frame > 0))):
        lon, lat, value = float(lons[col]), float(lats[row]), float(frame[row, col])
        bins[(int((lon + 180) // BIN_SIZE), int((lat + 90) // BIN_SIZE))].append((lon, lat, value))

    samples = []
    for points in bins.values():
        sample = sorted(points, key=lambda point: point[2], reverse=True)[:6]
        total = sum(point[2] for point in sample)
        lon = sum(point[0] * point[2] for point in sample) / total
        lat = sum(point[1] * point[2] for point in sample) / total
        samples.append((total, lon, lat, sample))
    result = sorted(samples, reverse=True)[:145]
    print(f"{SAMPLE_DATE}: {sum(len(sample) for _, _, _, sample in result)} sampled cells in {len(result)} bins", flush=True)
    return result


def load_texture(path):
    texture = Image.new("RGB", (2048, 2048))
    for y in range(8):
        for x in range(8):
            with Image.open(path / f"{x}-{y}.jpg") as tile:
                if tile.size != (256, 256):
                    raise ValueError(f"Unexpected NASA tile size at {x}/{y}.")
                texture.paste(tile, (x * 256, y * 256))
    return np.asarray(texture)


def ease(start, end, time):
    ratio = min(1, max(0, (time - start) / (end - start)))
    return ratio * ratio * (3 - 2 * ratio)


class Film:
    def __init__(self, texture, bins):
        self.texture = texture
        self.bins = bins
        y, x = np.mgrid[:SIZE, :SIZE].astype(np.float32)
        x, y = (x - CENTER) / RADIUS, (CENTER - y) / RADIUS
        distance = np.hypot(x, y)
        self.mask = distance <= 1
        self.x, self.y = x[self.mask], y[self.mask]
        self.z = np.sqrt(np.maximum(0, 1 - self.x**2 - self.y**2))
        glow = np.exp(-((distance - 1.004) / 0.027) ** 2) * (0.43 + 0.31 * np.clip(y - x, -1, 1))
        self.space = (np.array(BACKGROUND) + glow[..., None] * [13, 48, 82]).astype(np.uint8)
        self.limb = (1 - self.z) ** 5 * (0.75 + 0.25 * np.clip(self.y - self.x, -1, 1))

    def globe(self, longitude, cos_lat, sin_lat):
        lon = longitude + np.degrees(np.arctan2(self.x, self.z * cos_lat - self.y * sin_lat))
        lat = np.arcsin(np.clip(self.z * sin_lat + self.y * cos_lat, -0.996272, 0.996272))
        u = ((lon + 180) / 360 % 1) * 2048
        v = (0.5 - np.arcsinh(np.tan(lat)) / (2 * np.pi)) * 2048
        u0, v0 = u.astype(np.int32), np.clip(v.astype(np.int32), 0, 2047)
        u1, v1 = (u0 + 1) % 2048, np.minimum(v0 + 1, 2047)
        fu, fv = (u - u0)[:, None], (v - v0)[:, None]
        top = self.texture[v0, u0] * (1 - fu) + self.texture[v0, u1] * fu
        bottom = self.texture[v1, u0] * (1 - fu) + self.texture[v1, u1] * fu
        pixels = (top * (1 - fv) + bottom * fv) * (0.64 + self.z[:, None] * 0.40)
        pixels += self.limb[:, None] * [18, 48, 76]
        frame = self.space.copy()
        frame[self.mask] = np.clip(pixels, 0, 255).astype(np.uint8)
        return Image.fromarray(frame)

    def frame(self, time):
        angle = 2 * np.pi * time / DURATION
        longitude = 57 + 18 * (1 - np.cos(angle)) / 2
        latitude = np.radians(23 + 4 * (1 - np.cos(angle)) / 2)
        cos_lat, sin_lat = np.cos(latitude), np.sin(latitude)
        globe = self.globe(longitude, cos_lat, sin_lat)
        clear = 1 - ease(10.1, 11.9, time)
        if time < 0.65 or clear <= 0:
            return globe

        def project(lon, lat):
            lon, lat = np.radians(lon - longitude), np.radians(lat)
            forward = np.cos(lat) * np.cos(lon)
            height = np.sin(lat)
            return (CENTER + RADIUS * np.cos(lat) * np.sin(lon),
                    CENTER - RADIUS * (height * cos_lat - forward * sin_lat),
                    height * sin_lat + forward * cos_lat)

        layer = Image.new("RGBA", (SIZE, SIZE))
        glow = Image.new("RGBA", (SIZE, SIZE))
        marks, bloom = ImageDraw.Draw(layer), ImageDraw.Draw(glow)
        for i, (total, lon, lat, points) in enumerate(self.bins):
            x, y, depth = project(lon, lat)
            if depth < 0.025:
                continue
            limb_fade = min(1, depth * 3)
            phase = ((i * 37) % 113) / 113
            collect = 3.8 + 1.7 * phase
            finish = collect + 1.65
            settled = ease(finish - 0.22, finish + 0.62, time) * clear * limb_fade
            if settled > 0:
                radius = min(12, 2.7 + np.log1p(total / 9000) * 1.85)
                marks.ellipse((x - radius, y - radius, x + radius, y + radius),
                              outline=(106, 225, 230, round(185 * settled)), width=1)
                marks.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(255, 200, 116, round(250 * settled)))
                bloom.ellipse((x - radius * 1.7, y - radius * 1.7, x + radius * 1.7, y + radius * 1.7),
                              fill=(255, 160, 79, round(112 * settled)))

            for j, (point_lon, point_lat, value) in enumerate(points):
                show = 0.65 + 1.85 * phase + j * 0.09
                alpha = ease(show, show + 0.62, time) * clear * (1 - settled)
                if alpha <= 0 or time > finish + 0.48:
                    continue
                sx, sy, source_depth = project(point_lon, point_lat)
                if source_depth <= 0.025:
                    continue
                alpha *= min(1, source_depth * 4)
                progress = ease(collect + j * 0.07, finish, time)
                radius = min(3.3, 1.35 + np.log1p(value / 3000) * 0.43)

                def trajectory(part):
                    return (sx + (x - sx) * part, sy + (y - sy) * part - np.sin(np.pi * part) * (16 + phase * 26))

                px, py = trajectory(progress)
                if 0 < progress < 1:
                    tail = [trajectory(max(0, progress - delta)) for delta in (0.54, 0.39, 0.23, 0.10, 0)]
                    marks.line(tail, fill=(78, 228, 255, round(171 * alpha)), width=1)
                    bloom.line(tail, fill=(37, 212, 255, round(125 * alpha)), width=3)
                marks.ellipse((px - radius, py - radius, px + radius, py + radius), fill=(171, 247, 255, round(245 * alpha)))
                bloom.ellipse((px - 6, py - 6, px + 6, py + 6), fill=(65, 223, 250, round(115 * alpha)))
        softened = glow.filter(ImageFilter.GaussianBlur(4))
        globe.paste(softened, (0, 0), softened.getchannel("A"))
        globe.paste(layer, (0, 0), layer)
        return globe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graced", type=Path, required=True)
    parser.add_argument("--tiles", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/intro"))
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    film = Film(load_texture(args.tiles), load_sample(args.graced))
    args.output.mkdir(parents=True, exist_ok=True)
    film.frame(8.1).save(args.output / "graced-night-v1.webp", quality=86)
    command = [
        args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{SIZE}x{SIZE}", "-framerate", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
        "-crf", "23", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(args.output / "graced-night-v1.mp4"),
    ]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        for index in range(DURATION * FPS):
            encoder.stdin.write(film.frame(index / FPS).tobytes())
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError("ffmpeg could not encode the opening film.")


if __name__ == "__main__":
    main()
