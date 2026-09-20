#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["markdown>=3.5", "xhtml2pdf>=0.2.16"]
# ///
"""Render a Markdown file to PDF for outreach attachments.

Usage: uv run scripts/md_to_pdf.py <input.md> <output.pdf>

Design goals: legibility over decoration. Standard letter, 1-inch margins,
sans-serif body, no color other than link blue. Anchor tags preserved.
"""
from __future__ import annotations

import sys
from pathlib import Path

import markdown
from xhtml2pdf import pisa

CSS = """
@page {
  size: letter;
  margin: 0.9in 0.9in 0.9in 0.9in;
  @frame footer {
    -pdf-frame-content: footer_content;
    left: 0.9in; width: 6.7in; top: 10.4in; height: 0.3in;
  }
}
body {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.4;
  color: #1a1a1a;
}
h1 { font-size: 18pt; font-weight: 700; margin: 0 0 0.35em 0; color: #0a0a0a; }
h2 { font-size: 12pt; font-weight: 700; margin: 1.3em 0 0.25em 0; color: #0a0a0a; -pdf-keep-with-next: true; }
h3 { font-size: 10.5pt; font-weight: 700; margin: 0.9em 0 0.15em 0; }
p  { margin: 0.35em 0; }
a  { color: #0855c4; text-decoration: none; }
ol, ul { margin: 0.35em 0 0.35em 1.3em; padding: 0; }
li { margin: 0.12em 0; }
hr { border: none; border-top: 0.6pt solid #cccccc; margin: 1.1em 0; }
strong { font-weight: 700; }
em { font-style: italic; }
.footer { font-size: 8.5pt; color: #888888; text-align: center; }
"""

FOOTER = (
    '<div id="footer_content" class="footer">'
    'IRCC policy digest, Jan-Sep 2025, compiled by Chi. '
    'Argus: github.com/coolchigi/argus. Page <pdf:pagenumber> of <pdf:pagecount>.'
    "</div>"
)


def render(md_path: Path, pdf_path: Path) -> None:
    md_text = md_path.read_text(encoding="utf-8")
    html_body = markdown.markdown(
        md_text,
        extensions=["extra", "sane_lists", "smarty"],
    )
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>"
        f"{FOOTER}{html_body}"
        "</body></html>"
    )
    with pdf_path.open("wb") as f:
        result = pisa.CreatePDF(html, dest=f, encoding="utf-8")
    if result.err:
        raise SystemExit(f"pisa reported {result.err} error(s)")
    print(f"wrote {pdf_path} ({pdf_path.stat().st_size} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: md_to_pdf.py <input.md> <output.pdf>")
    render(Path(sys.argv[1]), Path(sys.argv[2]))
