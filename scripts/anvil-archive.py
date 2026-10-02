"""Deterministic, bounded resource archive I/O. Never executes packaged code."""
import argparse
import os
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath

MAX_TOTAL = 1024 * 1024 * 1024
MAX_FILE = 256 * 1024 * 1024
MAX_ENTRIES = 50000


def safe_name(name):
    parts = name.rstrip('/').split('/')
    if (not name or '\\' in name or any(ord(c) < 32 for c in name)
            or (parts[0] != 'Anvil.app' and name != 'README.txt') or any(p in ('', '.', '..') for p in parts)):
        raise ValueError('Unsafe ZIP entry: ' + repr(name))


def create(app, archive, readme):
    app = Path(app)
    if app.name != 'Anvil.app' or app.is_symlink() or not app.is_dir():
        raise ValueError('Expected a regular Anvil.app directory')
    readme = Path(readme)
    if readme.name != 'README.txt' or readme.parent != app.parent or readme.is_symlink() or not readme.is_file():
        raise ValueError('Expected sibling regular README.txt')
    entries = [app] + sorted(app.rglob('*'), key=lambda p: str(p.relative_to(app))) + [readme]
    total = 0
    if len(entries) > MAX_ENTRIES:
        raise ValueError('Too many archive entries')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for entry in entries:
            info = entry.lstat()
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise ValueError('Archive source contains a link or special file')
            name = entry.relative_to(app.parent).as_posix() + ('/' if entry.is_dir() else '')
            safe_name(name)
            total += info.st_size if entry.is_file() else 0
            if info.st_size > MAX_FILE or total > MAX_TOTAL:
                raise ValueError('Archive source exceeds bounds')
            metadata = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            metadata.create_system = 3
            metadata.external_attr = info.st_mode << 16
            metadata.compress_type = zipfile.ZIP_DEFLATED
            if entry.is_dir():
                output.writestr(metadata, b'')
            else:
                with entry.open('rb') as source, output.open(metadata, 'w') as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)


def extract(archive, destination):
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Extraction destination must not exist')
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            raise ValueError('Invalid ZIP entry count')
        seen = set()
        total = 0
        for entry in entries:
            safe_name(entry.filename)
            key = entry.filename.rstrip('/').casefold()
            mode = entry.external_attr >> 16
            if key in seen or entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Duplicate, encrypted or unsupported ZIP entry')
            seen.add(key)
            if (entry.is_dir() and not stat.S_ISDIR(mode)) or (not entry.is_dir() and not stat.S_ISREG(mode)):
                raise ValueError('ZIP entry is a link, special file or lacks regular type evidence')
            total += entry.file_size
            if entry.file_size > MAX_FILE or total > MAX_TOTAL:
                raise ValueError('ZIP exceeds extraction bounds')
        destination.mkdir(parents=True)
        try:
            for entry in entries:
                target = destination.joinpath(*PurePosixPath(entry.filename).parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    os.chmod(target, (entry.external_attr >> 16) & 0o777)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(entry) as content, target.open('xb') as output:
                        shutil.copyfileobj(content, output, 1024 * 1024)
                    os.chmod(target, (entry.external_attr >> 16) & 0o777)
        except Exception:
            shutil.rmtree(destination)
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['create', 'extract'])
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('--readme')
    args = parser.parse_args()
    if args.action == 'create':
        create(args.source, args.destination, args.readme)
    else:
        extract(args.source, args.destination)
