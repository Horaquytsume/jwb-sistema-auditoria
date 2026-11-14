import hashlib
import io
import unittest
from openpyxl import Workbook
from python_engine.extract import extract_document


class TestExtract(unittest.TestCase):
    def test_txt_and_sha256(self):
        data = 'Orçamento R$ 150,00'.encode()
        result = extract_document('test.txt', data)
        self.assertIn('150,00', result['text'])
        self.assertEqual(result['fileHash'], hashlib.sha256(data).hexdigest())

    def test_excel(self):
        wb = Workbook()
        wb.active.append(['Peça', 'Preço'])
        wb.active.append(['Filtro', 100])
        buffer = io.BytesIO()
        wb.save(buffer)
        result = extract_document('test.xlsx', buffer.getvalue())
        self.assertIn('Filtro', result['text'])
        self.assertIn('100', result['text'])

    def test_bad_extension(self):
        with self.assertRaises(ValueError):
            extract_document('malware.exe', b'unsafe')

    def test_size_limit(self):
        with self.assertRaises(ValueError):
            extract_document('large.txt', b'x' * 2_000_001)


if __name__ == '__main__': unittest.main()
