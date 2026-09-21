"""The document catalog and template parsing.

The Common Paper templates hold only the standard terms. Everything the parties must decide is a
reference to a page that lives outside the template (the Cover Page, Key Terms, Order Form, Statement
of Work or Business Terms), written as `<span class="orderform_link">Subscription Period</span>` and so
on. This module turns each template into a spec: the fields to collect, the party roles, and the terms
as clean markdown. The assistant asks for the fields and the frontend renders the generated front page.

The Mutual NDA has a real cover page template and its own typed fields (see schemas.NdaFields), so it is
in the catalog but has no generic spec.
"""

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

NDA_KEY = "mutual-nda"
_NDA_FILENAMES = {"Mutual-NDA.md", "Mutual-NDA-coverpage.md"}

# Terms that name a party rather than a deal term.
PARTY_ROLES = ("Customer", "Provider", "Partner", "Company")

# The external page a field belongs to, in the order they are presented.
SOURCES = ("coverpage", "orderform", "sow", "businessterms", "keyterms")

_FIELD_SPAN = re.compile(r'<span class="(coverpage|keyterms|orderform|sow|businessterms)_link"(?: id="[^"]*")?>([^<]*)</span>')
_HEADER_SPAN = re.compile(r'<span class="header_[23]"(?: id="[^"]*")?>([^<]*)</span>')
_ANY_SPAN_TAG = re.compile(r"</?span[^>]*>")
_LIST_NUMBER = re.compile(r"^\s*\d+\.\s+")
_SENTENCE_BREAK = re.compile(r'(?<!U\.S\.)(?<!e\.g\.)(?<!i\.e\.)(?<=[.;])\s+(?=[A-Z(“"])')
_POSSESSIVE = re.compile(r"[’']s$")
_TOKEN = "{}"
_TOKEN_RE = re.compile("(\\d+)")
_CONTEXT_MAX_CHARS = 300


@dataclass(frozen=True)
class CatalogEntry:
    key: str
    name: str
    description: str
    filename: str


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    source: str
    context: str


@dataclass(frozen=True)
class DocumentSpec:
    key: str
    name: str
    description: str
    parties: tuple[str, ...]
    fields: tuple[Field, ...]
    terms: str


def templates_dir() -> Path:
    override = os.environ.get("PRELEGAL_TEMPLATES_DIR")
    return Path(override) if override else Path(__file__).resolve().parents[2] / "templates"


@lru_cache
def catalog() -> tuple[CatalogEntry, ...]:
    """Every document we can generate, in catalog order. The NDA's two catalog entries are one document."""
    raw = json.loads((templates_dir().parent / "catalog.json").read_text(encoding="utf-8"))
    entries: list[CatalogEntry] = []
    for item in raw:
        filename = item["filename"]
        if filename in _NDA_FILENAMES:
            if any(e.key == NDA_KEY for e in entries):
                continue
            name = re.sub(r"\s*\((Standard Terms|Cover Page)\)$", "", item["name"])
            entries.append(CatalogEntry(NDA_KEY, name, item["description"], filename))
        else:
            entries.append(CatalogEntry(Path(filename).stem.lower(), item["name"], item["description"], filename))
    return tuple(entries)


def catalog_entry(key: str) -> CatalogEntry | None:
    return next((e for e in catalog() if e.key == key), None)


def slugify(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def _base_label(label: str) -> str:
    return _POSSESSIVE.sub("", label.strip())


def _canonical_labels(labels: list[str]) -> dict[str, str]:
    """Maps each label to the form used for its field: possessives dropped, and "X" / "Xs" merged into
    whichever of the two the template uses more often."""
    counts: dict[str, int] = {}
    for label in labels:
        base = _base_label(label)
        counts[base] = counts.get(base, 0) + 1
    canonical: dict[str, str] = {}
    for base, count in counts.items():
        singular, plural = (base[:-1], base) if base.endswith("s") else (base, base + "s")
        other = counts.get(plural if base == singular else singular)
        if other is None or count > other:
            canonical[base] = base
        elif count < other:
            canonical[base] = plural if base == singular else singular
        else:  # an exact tie: settle on the plural so both spellings agree
            canonical[base] = plural
    return canonical


def _plain(text: str) -> str:
    text = _HEADER_SPAN.sub(r"\1", text)
    text = _ANY_SPAN_TAG.sub("", text)
    return text.replace("**", "").replace("<", "").replace(">", "")


def _context_for(line: str, occurrences: list[tuple[int, str]]) -> dict[int, str]:
    """For each field occurrence in `line` (index, label), the sentence it appears in."""
    counter = iter(range(len(occurrences)))
    tokenised = _FIELD_SPAN.sub(lambda m: _TOKEN.format(next(counter)), line)
    plain = _LIST_NUMBER.sub("", _plain(tokenised)).strip()
    labels = [label for _, label in occurrences]
    contexts: dict[int, str] = {}
    for sentence in _SENTENCE_BREAK.split(plain):
        if "highlighted and capitalized" in sentence:  # the "Variable" definition just lists examples
            continue
        text = " ".join(_TOKEN_RE.sub(lambda m: labels[int(m.group(1))], sentence).split())
        if len(text) > _CONTEXT_MAX_CHARS:
            text = text[: _CONTEXT_MAX_CHARS - 1].rstrip() + "…"
        for match in _TOKEN_RE.finditer(sentence):
            contexts.setdefault(occurrences[int(match.group(1))][0], text)
    return contexts


def parse_template(entry: CatalogEntry, markdown: str) -> DocumentSpec:
    lines = markdown.replace("\r\n", "\n").split("\n")
    if lines and lines[0].startswith("# "):
        lines = lines[1:]

    found = [(m.group(1), m.group(2)) for line in lines for m in _FIELD_SPAN.finditer(line)]
    canonical = _canonical_labels([label for _, label in found])

    order: list[str] = []
    sources: dict[str, dict[str, int]] = {}
    contexts: dict[str, str] = {}
    labels: dict[str, str] = {}
    for line in lines:
        matches = list(_FIELD_SPAN.finditer(line))
        if not matches:
            continue
        keys = [slugify(canonical[_base_label(m.group(2))]) for m in matches]
        for match, key in zip(matches, keys):
            label = canonical[_base_label(match.group(2))]
            if key not in labels:
                labels[key] = label
                order.append(key)
            by_source = sources.setdefault(key, {})
            by_source[match.group(1)] = by_source.get(match.group(1), 0) + 1
        occurrences = [(i, m.group(2)) for i, m in enumerate(matches)]
        for index, context in _context_for(line, occurrences).items():
            contexts.setdefault(keys[index], context)

    parties = tuple(role for role in PARTY_ROLES if slugify(role) in labels)
    parties = tuple(sorted(parties, key=lambda role: order.index(slugify(role))))
    fields = tuple(
        Field(
            key=key,
            label=labels[key],
            source=max(sources[key], key=lambda s: (sources[key][s], -SOURCES.index(s))),
            context=contexts.get(key, ""),
        )
        for key in order
        if labels[key] not in PARTY_ROLES
    )

    body = "\n".join(_render_line(line) for line in lines).strip()
    return DocumentSpec(entry.key, entry.name, entry.description, parties, fields, body)


def _render_line(line: str) -> str:
    """One line of the terms as plain markdown: defined terms and headings in bold, no HTML."""
    line = _FIELD_SPAN.sub(lambda m: f"**{m.group(2)}**", line)
    line = _HEADER_SPAN.sub(lambda m: f"**{m.group(1)}**", line)
    return _ANY_SPAN_TAG.sub("", line)


@lru_cache
def get_spec(key: str) -> DocumentSpec | None:
    """The generic spec for a document, or None for the NDA and for unknown keys."""
    entry = catalog_entry(key)
    if entry is None or entry.key == NDA_KEY:
        return None
    return parse_template(entry, (templates_dir() / entry.filename).read_text(encoding="utf-8"))
