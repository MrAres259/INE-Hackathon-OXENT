"""Shared ingestion helpers for ATALAYA."""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path
from typing import Iterable, Sequence
import unicodedata
import zipfile

import numpy as np
import pandas as pd


def norm_name(text: str | None) -> str:
    """Normalize geographic/unit names.
    
    Converts to UPPERCASE, removes accents (NFKD), replaces Ñ->N,
    converts punctuation (.,;:'"()-/) to space, collapses whitespace, strips.
    Returns empty string for None or NaN.
    """
    if text is None:
        return ""
    if isinstance(text, float) and np.isnan(text):
        return ""
    s = str(text).strip()
    if not s or s.lower() == "nan":
        return ""

    s = s.upper().replace("Ñ", "N")
    # Decompose unicode and remove combining diacritics
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    # Replace punctuation characters with space
    s = re.sub(r'[\.,;:\'"()\-/\\]', ' ', s)
    # Collapse multiple whitespace characters into single space
    return " ".join(s.split())


def norm_col(name: str | None) -> str:
    """Normalize table column header.
    
    Converts to UPPERCASE without accents, replaces spaces and hyphens with '_',
    strips BOM and quotes.
    """
    if name is None:
        return ""
    s = str(name).strip()
    s = s.replace("\ufeff", "").replace('"', '').replace("'", "")
    s = s.upper().replace("Ñ", "N")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = re.sub(r'[\s\-/\.]+', '_', s)
    s = re.sub(r'[^A-Z0-9_]', '', s)
    s = re.sub(r'_+', '_', s).strip('_')
    return s


def zpad(value: any, width: int) -> str:
    """Format numeric/string code with leading zeros.
    
    Examples: 7 -> '07', '7.0' -> '07', '07101' -> '07101'.
    """
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "0".zfill(width)
    val_str = str(value).strip()
    if not val_str or val_str.lower() == "nan":
        return "0".zfill(width)

    # Handle float strings like '7.0'
    if "." in val_str:
        try:
            f = float(val_str)
            if f.is_integer():
                val_str = str(int(f))
        except ValueError:
            pass

    return val_str.zfill(width)


def to_num(s: pd.Series) -> pd.Series:
    """Convert string series to float.
    
    Removes thousand commas, spaces, '%'.
    Converts '*', 'N/D', 'ND', '-', '' to NaN.
    """
    if s is None:
        return pd.Series(dtype=float)

    def _clean_val(v):
        if v is None:
            return np.nan
        if isinstance(v, (int, float)):
            return float(v) if not np.isnan(v) else np.nan
        sv = str(v).strip()
        if sv in ("", "*", "N/D", "ND", "-", "N.D.", "n/d", "null", "none"):
            return np.nan
        sv = sv.replace(",", "").replace(" ", "").replace("%", "")
        try:
            return float(sv)
        except (ValueError, TypeError):
            return np.nan

    return s.map(_clean_val).astype(float)


def pick_col(df: pd.DataFrame, aliases: Sequence[str], *, required: bool = True) -> str | None:
    """Find the first matching column name from aliases in df.columns.
    
    Aliases are compared normalized with norm_col.
    If required and no alias found, raises ValueError listing available columns.
    """
    col_norm_map = {norm_col(c): c for c in df.columns}
    for alias in aliases:
        target = norm_col(alias)
        if target in col_norm_map:
            return col_norm_map[target]
    if required:
        cols = list(df.columns)
        raise ValueError(
            f"None of the aliases {list(aliases)} found in table columns: {cols}"
        )
    return None


def _dedup_columns(cols: Sequence[str]) -> list[str]:
    """Deduplicate normalized column names by adding suffixes _2, _3, etc."""
    seen: dict[str, int] = {}
    result = []
    for i, c in enumerate(cols):
        norm = norm_col(c) if c else ""
        if not norm:
            norm = f"COL_{i}"
        if norm in seen:
            seen[norm] += 1
            result.append(f"{norm}_{seen[norm]}")
        else:
            seen[norm] = 1
            result.append(norm)
    return result


def _clean_empty_rows_and_cols(df: pd.DataFrame) -> pd.DataFrame:
    """Remove columns and rows that are completely empty or whitespace."""
    if df.empty:
        return df

    # Drop completely empty columns
    keep_cols = []
    for col in df.columns:
        s = df[col].dropna()
        if len(s) > 0 and not (s.astype(str).str.strip() == "").all():
            keep_cols.append(col)

    df = df[keep_cols] if keep_cols else pd.DataFrame(columns=keep_cols)
    if df.empty:
        return df

    # Drop completely empty rows
    non_empty_row = pd.Series(False, index=df.index)
    for col in df.columns:
        s = df[col].fillna("").astype(str).str.strip()
        non_empty_row |= (s != "")

    return df.loc[non_empty_row].reset_index(drop=True)


def _detect_csv_encoding_and_delimiter(
    file_bytes: bytes,
) -> tuple[str, str, list[list[str]]]:
    """Detect encoding, delimiter and parse top 35 rows for header detection."""
    encodings = ["utf-8-sig", "cp1252", "latin-1"]
    decoded_text = ""
    chosen_enc = "utf-8-sig"

    for enc in encodings:
        try:
            # Check if it decodes cleanly
            decoded_text = file_bytes[:100000].decode(enc)
            chosen_enc = enc
            break
        except UnicodeDecodeError:
            continue

    lines = decoded_text.splitlines()[:35]
    sample = "\n".join(lines[:20])

    delimiters = [",", "|", ";", "\t"]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        counts = {d: sum(line.count(d) for line in lines[:5]) for d in delimiters}
        delimiter = max(counts, key=counts.get)
        if counts[delimiter] == 0:
            delimiter = ","

    parsed_rows = []
    for line in lines:
        try:
            row = next(csv.reader([line], delimiter=delimiter))
            parsed_rows.append(row)
        except Exception:
            parsed_rows.append([c.strip() for c in line.split(delimiter)])

    return chosen_enc, delimiter, parsed_rows


def _find_header_row_index(
    rows: list[list[str]],
    expect_any: Iterable[str],
) -> int:
    """Find the index of the header row matching at least 2 expected columns."""
    expected_norms = {norm_col(x) for x in expect_any if x}
    if not expected_norms:
        return 0

    min_matches = min(2, len(expected_norms))

    for idx, row in enumerate(rows[:30]):
        norm_row = {norm_col(c) for c in row if c}
        matches = norm_row.intersection(expected_norms)
        if len(matches) >= min_matches:
            return idx

    sample_cols = [norm_col(c) for c in rows[0]] if rows else []
    raise ValueError(
        f"Header matching {list(expect_any)} not found in first 30 rows. "
        f"First row columns found: {sample_cols}"
    )


def read_table(
    path: Path | str,
    *,
    sheet: str | int | None = None,
    expect_any: Iterable[str] = (),
) -> pd.DataFrame:
    """Read .csv, .txt, .xlsx, .xls, or .zip into a DataFrame with normalized column headers.
    
    All columns are read as str (dtype=str).
    Empty rows and empty columns are dropped.
    Duplicate column names receive suffixes _2, _3.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    suffix = path.suffix.lower()

    if suffix == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            # Pick largest candidate file
            candidates = [
                m for m in zf.infolist()
                if not m.filename.startswith("__MACOSX")
                and not m.filename.endswith("/")
                and any(m.filename.lower().endswith(ext) for ext in [".csv", ".txt", ".xlsx", ".xls"])
            ]
            if not candidates:
                raise ValueError(f"No valid data file found inside zip archive: {path}")
            largest = max(candidates, key=lambda m: m.file_size)
            raw_bytes = zf.read(largest.filename)
            inner_ext = Path(largest.filename).suffix.lower()

            if inner_ext in (".xlsx", ".xls"):
                engine = "openpyxl" if inner_ext == ".xlsx" else "xlrd"
                return _read_excel_from_bytes(raw_bytes, sheet=sheet, expect_any=expect_any, engine=engine)
            else:
                return _read_csv_from_bytes(raw_bytes, expect_any=expect_any)

    if suffix in (".xlsx", ".xls"):
        engine = "openpyxl" if suffix == ".xlsx" else "xlrd"
        return _read_excel_file(path, sheet=sheet, expect_any=expect_any, engine=engine)

    # For standard CSV/TXT files
    with open(path, "rb") as f:
        file_bytes = f.read(150000)

    chosen_enc, delimiter, parsed_rows = _detect_csv_encoding_and_delimiter(file_bytes)
    header_idx = _find_header_row_index(parsed_rows, expect_any)

    df = pd.read_csv(
        path,
        encoding=chosen_enc,
        sep=delimiter,
        skiprows=header_idx,
        dtype=str,
        low_memory=False,
    )
    df.columns = _dedup_columns(df.columns)
    return _clean_empty_rows_and_cols(df)


def _read_csv_from_bytes(raw_bytes: bytes, expect_any: Iterable[str]) -> pd.DataFrame:
    chosen_enc, delimiter, parsed_rows = _detect_csv_encoding_and_delimiter(raw_bytes)
    header_idx = _find_header_row_index(parsed_rows, expect_any)

    df = pd.read_csv(
        io.BytesIO(raw_bytes),
        encoding=chosen_enc,
        sep=delimiter,
        skiprows=header_idx,
        dtype=str,
        low_memory=False,
    )
    df.columns = _dedup_columns(df.columns)
    return _clean_empty_rows_and_cols(df)


def _read_excel_file(
    path: Path,
    sheet: str | int | None,
    expect_any: Iterable[str],
    engine: str,
) -> pd.DataFrame:
    raw_df = pd.read_excel(
        path,
        sheet_name=sheet if sheet is not None else 0,
        header=None,
        dtype=str,
        engine=engine,
    )
    return _process_raw_excel_df(raw_df, expect_any)


def _read_excel_from_bytes(
    raw_bytes: bytes,
    sheet: str | int | None,
    expect_any: Iterable[str],
    engine: str,
) -> pd.DataFrame:
    raw_df = pd.read_excel(
        io.BytesIO(raw_bytes),
        sheet_name=sheet if sheet is not None else 0,
        header=None,
        dtype=str,
        engine=engine,
    )
    return _process_raw_excel_df(raw_df, expect_any)


def _process_raw_excel_df(raw_df: pd.DataFrame, expect_any: Iterable[str]) -> pd.DataFrame:
    rows: list[list[str]] = []
    max_check = min(35, len(raw_df))
    for i in range(max_check):
        row_vals = [str(x) if pd.notna(x) else "" for x in raw_df.iloc[i].tolist()]
        rows.append(row_vals)

    header_idx = _find_header_row_index(rows, expect_any)
    header_cols = [str(x) if pd.notna(x) else "" for x in raw_df.iloc[header_idx].tolist()]

    data_df = raw_df.iloc[header_idx + 1:].copy().reset_index(drop=True)
    data_df.columns = _dedup_columns(header_cols)
    return _clean_empty_rows_and_cols(data_df)


def write_parquet(df: pd.DataFrame, path: Path | str) -> int:
    """Save DataFrame to Parquet, creating directories as needed. Returns row count."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return len(df)


def read_parquet(path: Path | str) -> pd.DataFrame:
    """Load DataFrame from Parquet file."""
    return pd.read_parquet(path)
