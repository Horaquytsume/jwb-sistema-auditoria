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

    def test_excel_too_many_columns(self):
        wb = Workbook()
        wb.active.cell(row=1, column=501, value='x')
        buffer = io.BytesIO()
        wb.save(buffer)
        with self.assertRaisesRegex(ValueError, '500 colunas'):
            extract_document('wide.xlsx', buffer.getvalue())

    def test_excel_text_limit(self):
        wb = Workbook()
        for row in range(1, 10):
            wb.active.cell(row=row, column=1, value='x' * 30000)
        buffer = io.BytesIO()
        wb.save(buffer)
        result = extract_document('large-text.xlsx', buffer.getvalue())
        self.assertLessEqual(len(result['text']), 200000)
        self.assertTrue(any('truncado' in note for note in result['notes']))

    def test_bad_extension(self):
        with self.assertRaises(ValueError):
            extract_document('malware.exe', b'unsafe')

    def test_size_limit(self):
        with self.assertRaises(ValueError):
            extract_document('large.txt', b'x' * 2_000_001)


if __name__ == '__main__': unittest.main()
