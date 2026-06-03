import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {
    '.css',
    '.html',
    '.js',
    '.json',
    '.md',
    '.py',
    '.txt',
}
SKIP_DIRS = {
    '.git',
    '.tmp',
    '__pycache__',
    'exports',
    'ocr_models',
}
MOJIBAKE_MARKERS = [
    '榛樿',
    '鍩洪',
    '锛',
    '涓婁',
    '涓嬭',
    '鎴',
    '浠',
    '绗',
    '鍚',
    '鏁',
    '瀵',
    '鐮',
    '\ufffd',
]


def iter_text_files():
    for path in ROOT.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if path.name == 'test_encoding.py':
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        yield path


class SourceEncodingTests(unittest.TestCase):
    def test_text_files_are_utf8_and_not_mojibake(self):
        for path in iter_text_files():
            with self.subTest(path=str(path.relative_to(ROOT))):
                text = path.read_text(encoding='utf-8')
                found = [marker for marker in MOJIBAKE_MARKERS if marker in text]
                self.assertFalse(found, f"疑似乱码片段: {found}")


if __name__ == '__main__':
    unittest.main()
