"""Extrator local de documentos para a API Node. Recebe JSON em stdin; devolve JSON em stdout."""
import base64
import csv
import hashlib
import io
import json
import os
import sys
import zipfile

MAX_BYTES = 2_000_000
MAX_TEXT = 200_000
MAX_ROWS = 20_000
MAX_COLUMNS = 500
MAX_CELLS = 200_000
MAX_ZIP_UNCOMPRESSED = 30_000_000


def extract_document(name, payload):
    if not isinstance(name, str) or not isinstance(payload, bytes):
        raise ValueError('Documento inválido.')
    if not payload or len(payload) > MAX_BYTES:
        raise ValueError('Arquivo vazio ou maior que 2 MB.')
    extension = os.path.splitext(name.lower())[1]
    notes = []
    if extension == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(payload), strict=False)
        if reader.is_encrypted:
            raise ValueError('PDF protegido por senha não é compatível.')
        if len(reader.pages) > 100:
            raise ValueError('PDF excede o limite de 100 páginas.')
        chunks = [page.extract_text() or '' for page in reader.pages]
        text = '\n\n'.join(chunks)
        if not text.strip():
            notes.append('Nenhum texto extraível. PDFs digitalizados precisam de OCR.')
    elif extension == '.xlsx':
        from openpyxl import load_workbook
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                if sum(info.file_size for info in archive.infolist()) > MAX_ZIP_UNCOMPRESSED:
                    raise ValueError('Planilha descompactada excede o limite de segurança.')
            workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True, keep_links=False)
            chunks = []
            row_count = 0
            cell_count = 0
            text_size = 0
            truncated = False
            for sheet in workbook.worksheets:
                if sheet.max_column > MAX_COLUMNS:
                    raise ValueError('Planilha excede o limite de 500 colunas.')
                chunks.append(f'Planilha: {sheet.title}')
                for row in sheet.iter_rows(values_only=True):
                    row_count += 1
                    if row_count > MAX_ROWS:
                        raise ValueError('Planilha excede o limite de 20 mil linhas.')
                    cell_count += len(row)
                    if cell_count > MAX_CELLS:
                        raise ValueError('Planilha excede o limite de 200 mil células.')
                    cells = []
                    for cell in row:
                        if cell is None: cells.append('')
                        elif isinstance(cell, (int, float)) and not isinstance(cell, bool): cells.append(str(cell))
                        else: cells.append(str(cell))
                    line = ' | '.join(cells)
                    remaining = MAX_TEXT - text_size
                    if len(line) + 1 > remaining:
                        chunks.append(line[:max(0, remaining)])
                        truncated = True
                        break
                    chunks.append(line)
                    text_size += len(line) + 1
                if truncated:
                    break
            workbook.close()
            text = '\n'.join(chunks)
            if truncated:
                notes.append('Texto truncado em 200 mil caracteres; a análise precisa de conferência.')
        except zipfile.BadZipFile as exc:
            raise ValueError('Planilha XLSX inválida.') from exc
    elif extension in ('.csv', '.tsv', '.txt'):
        try:
            text = payload.decode('utf-8-sig')
        except UnicodeDecodeError as exc:
            raise ValueError('Arquivo de texto deve usar codificação UTF-8.') from exc
    else:
        raise ValueError('Formato não suportado; use PDF, XLSX, CSV, TSV ou TXT.')
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT]
        notes.append('Texto truncado em 200 mil caracteres; a análise precisa de conferência.')
    return {'fileName': os.path.basename(name), 'fileHash': hashlib.sha256(payload).hexdigest(), 'text': text, 'notes': notes}


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES * 2)
        request = json.loads(raw.decode('utf-8'))
        encoded = request.get('base64', '')
        if not isinstance(encoded, str) or len(encoded) > (MAX_BYTES * 4 // 3 + 8):
            raise ValueError('Arquivo maior que 2 MB.')
        payload = base64.b64decode(encoded, validate=True)
        result = extract_document(request.get('name', ''), payload)
        print(json.dumps({'ok': True, **result}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)[:300] or 'Falha ao extrair arquivo.'}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
