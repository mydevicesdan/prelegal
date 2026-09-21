import json
import re

import pytest
from fastapi.testclient import TestClient

from app import documents
from app.documents import CatalogEntry, catalog, get_spec, parse_template, slugify

GENERIC_KEYS = [e.key for e in catalog() if e.key != documents.NDA_KEY]


def entry(name="Test Agreement") -> CatalogEntry:
    return CatalogEntry("test", name, "A test.", "Test.md")


class TestCatalog:
    def test_lists_eleven_documents_with_the_nda_once(self):
        keys = [e.key for e in catalog()]
        assert len(keys) == 11 and len(set(keys)) == 11
        assert keys[0] == "mutual-nda"

    def test_covers_every_entry_in_catalog_json(self):
        raw = json.loads((documents.templates_dir().parent / "catalog.json").read_text(encoding="utf-8"))
        assert {e.filename for e in catalog()} <= {item["filename"] for item in raw}
        assert len(raw) - 1 == len(catalog())  # the NDA's two entries are one document

    def test_nda_name_drops_the_terms_or_cover_page_suffix(self):
        assert documents.catalog_entry("mutual-nda").name == "Mutual Non-Disclosure Agreement"

    def test_every_template_file_exists(self):
        for e in catalog():
            assert (documents.templates_dir() / e.filename).is_file(), e.filename


class TestSpecs:
    def test_the_nda_has_no_generic_spec(self):
        assert get_spec("mutual-nda") is None
        assert get_spec("nope") is None

    @pytest.mark.parametrize("key", GENERIC_KEYS)
    def test_every_template_parses_into_clean_markdown(self, key):
        spec = get_spec(key)
        assert spec.terms.startswith("1. **")
        assert "<span" not in spec.terms and "</span" not in spec.terms and "_link" not in spec.terms
        assert not spec.terms.startswith("# ")  # the title comes from the catalog

    @pytest.mark.parametrize("key", GENERIC_KEYS)
    def test_every_spec_has_two_parties_and_unique_fields(self, key):
        spec = get_spec(key)
        assert len(spec.parties) == 2 and set(spec.parties) <= set(documents.PARTY_ROLES)
        keys = [f.key for f in spec.fields]
        assert len(keys) == len(set(keys)) and keys
        assert all(f.source in documents.SOURCES for f in spec.fields)
        assert not {f.label for f in spec.fields} & set(documents.PARTY_ROLES)

    @pytest.mark.parametrize("key", GENERIC_KEYS)
    def test_every_field_has_a_readable_context_sentence(self, key):
        for f in get_spec(key).fields:
            assert f.context, f.key
            assert "" not in f.context and "<" not in f.context and "**" not in f.context
            assert len(f.context) <= 300

    @pytest.mark.parametrize("key", GENERIC_KEYS)
    def test_every_defined_term_the_template_references_stays_in_the_terms_in_bold(self, key):
        spec = get_spec(key)
        for f in spec.fields:
            assert re.search(rf"\*\*{re.escape(f.label)}\*\*", spec.terms), f.label

    # Pins each document's fields so a template change is noticed and reviewed.
    EXPECTED = {
        "csa": (("Customer", "Provider"), ["subscription-period", "technical-support", "dpa", "order-date",
                "non-renewal-notice-date", "effective-date", "general-cap-amount", "provider-covered-claims",
                "customer-covered-claims", "governing-law", "chosen-courts"]),
        "sla": (("Provider", "Customer"), ["target-uptime", "subscription-period", "target-response-time",
                "support-channel", "uptime-credit", "response-time-credit", "scheduled-downtime"]),
        "dpa": (("Customer", "Provider"), ["categories-of-personal-data", "categories-of-data-subjects", "agreement",
                "special-category-data", "special-category-data-restrictions-or-safeguards", "frequency-of-transfer",
                "nature-and-purpose-of-processing", "duration-of-processing", "approved-subprocessors",
                "governing-member-state", "security-policy", "provider-security-contact"]),
        "design-partner-agreement": (("Partner", "Provider"), ["term", "program", "fees", "effective-date",
                "governing-law", "chosen-courts", "notice-address"]),
        "partnership-agreement": (("Company", "Partner"), ["obligations", "payment-process", "payment-schedule",
                "territory", "brand-guidelines", "dpa", "effective-date", "end-date", "additional-warranties",
                "general-cap-amount", "increased-claims", "increased-cap-amount", "unlimited-claims",
                "company-covered-claim", "partner-covered-claims", "governing-law", "chosen-courts"]),
        "baa": (("Provider", "Company"), ["limitations", "breach-notification-period", "baa-effective-date", "agreement"]),
        "pilot-agreement": (("Customer", "Provider"), ["pilot-period", "effective-date", "general-cap-amount",
                "governing-law", "chosen-courts", "notice-address"]),
        "ai-addendum": (("Customer", "Provider"), ["training-data", "training-purposes", "training-restrictions",
                "improvement-restrictions"]),
    }

    @pytest.mark.parametrize("key", sorted(EXPECTED))
    def test_pinned_parties_and_fields(self, key):
        parties, field_keys = self.EXPECTED[key]
        spec = get_spec(key)
        assert spec.parties == parties
        assert [f.key for f in spec.fields] == field_keys

    def test_psa_and_software_license_have_the_expected_size(self):
        assert len(get_spec("psa").fields) == 22 and len(get_spec("software-license-agreement").fields) == 18

    def test_the_source_of_a_field_can_differ_between_documents(self):
        assert {f.key: f.source for f in get_spec("csa").fields}["effective-date"] == "keyterms"
        assert {f.key: f.source for f in get_spec("pilot-agreement").fields}["effective-date"] == "orderform"


class TestParser:
    def parse(self, body: str, name="Test Agreement"):
        return parse_template(entry(name), "# Test Agreement\n\n" + body)

    def test_fields_keep_first_appearance_order_and_a_context_sentence(self):
        spec = self.parse(
            '1. <span class="header_2">Term</span>\n'
            '    1. <span class="header_3">Start.</span>  This starts on the <span class="keyterms_link">Effective Date</span>. '
            'It ends after the <span class="orderform_link">Term Length</span>; earlier by notice.\n'
        )
        assert [(f.key, f.source) for f in spec.fields] == [("effective-date", "keyterms"), ("term-length", "orderform")]
        assert spec.fields[0].context == "This starts on the Effective Date."
        assert spec.fields[1].context == "It ends after the Term Length; earlier by notice."

    def test_headings_and_defined_terms_become_bold_and_spans_disappear(self):
        spec = self.parse(
            '1. <span class="header_2" id="1">Service</span>\n'
            '    1. <span class="header_3" id="1.1">Use.</span>  <span class="coverpage_link">Customer</span> may use it.\n'
            '    2. <span id="1.2">**"Thing"**</span></span> means a thing.\n'
        )
        assert spec.terms == '1. **Service**\n    1. **Use.**  **Customer** may use it.\n    2. **"Thing"** means a thing.'

    def test_party_roles_are_not_fields_and_come_in_first_appearance_order(self):
        spec = self.parse(
            '1. <span class="coverpage_link">Provider</span> serves <span class="coverpage_link">Customer’s</span> '
            'needs under <span class="keyterms_link">Governing Law</span>.\n'
        )
        assert spec.parties == ("Provider", "Customer")
        assert [f.key for f in spec.fields] == ["governing-law"]

    def test_possessives_are_merged_into_the_field(self):
        spec = self.parse(
            '1. <span class="keyterms_link">Security Policy</span> and <span class="keyterms_link">Security Policy’s</span> '
            'and <span class="keyterms_link">Security Policy\'s</span> scope.\n'
        )
        assert [f.label for f in spec.fields] == ["Security Policy"]
        assert "**Security Policy’s**" in spec.terms  # the text keeps the possessive as written

    @pytest.mark.parametrize(
        ("singular_uses", "plural_uses", "expected"),
        [(3, 1, "Period"), (1, 3, "Periods"), (2, 2, "Periods")],
    )
    def test_singular_and_plural_forms_merge_into_the_more_common_one(self, singular_uses, plural_uses, expected):
        body = "".join(
            f'{i}. <span class="orderform_link">Period</span> here.\n' for i in range(1, singular_uses + 1)
        ) + "".join(f'{i}. <span class="orderform_link">Periods</span> there.\n' for i in range(1, plural_uses + 1))
        assert [f.label for f in self.parse(body).fields] == [expected]

    def test_a_field_used_in_several_places_takes_its_most_common_source(self):
        spec = self.parse(
            '1. <span class="keyterms_link">Thing</span> a. <span class="orderform_link">Thing</span> b. '
            '<span class="orderform_link">Thing</span> c.\n'
        )
        assert spec.fields[0].source == "orderform"

    def test_the_variable_definition_is_not_used_as_context(self):
        spec = self.parse(
            '1. Real use: <span class="keyterms_link">Governing Law</span> applies.\n'
            '2. "Variable" means a word or phrase that is highlighted and capitalized, such as '
            '<span class="keyterms_link">Governing Law</span> or <span class="keyterms_link">Chosen Courts</span>.\n'
        )
        assert {f.key: f.context for f in spec.fields}["governing-law"] == "Real use: Governing Law applies."
        assert {f.key: f.context for f in spec.fields}["chosen-courts"] == ""

    def test_abbreviations_do_not_end_a_context_sentence(self):
        spec = self.parse('1. <span class="sow_link">Fees</span> are in U.S. Dollars, e.g. by wire. Then more.\n')
        assert spec.fields[0].context == "Fees are in U.S. Dollars, e.g. by wire."

    def test_long_context_is_truncated(self):
        spec = self.parse(f'1. <span class="keyterms_link">Thing</span> {"word " * 100}end.\n')
        assert len(spec.fields[0].context) == 300 and spec.fields[0].context.endswith("…")

    def test_autolinks_and_plain_markdown_survive(self):
        spec = self.parse("1. See <https://example.com/x> for **details**.\n")
        assert spec.terms == "1. See <https://example.com/x> for **details**."

    def test_slugify(self):
        assert slugify("Special Category Data Restrictions or Safeguards") == "special-category-data-restrictions-or-safeguards"


class TestDocumentsApi:
    def test_returns_the_spec_in_camel_case(self, client: TestClient):
        response = client.get("/api/documents/csa")
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"key", "name", "parties", "fields", "terms"}
        assert body["name"] == "Cloud Service Agreement"
        assert body["parties"] == ["Customer", "Provider"]
        assert {"key": "governing-law", "label": "Governing Law", "source": "keyterms"}.items() <= body["fields"][-2].items()
        assert body["terms"].startswith("1. **Service**")

    @pytest.mark.parametrize("key", GENERIC_KEYS)
    def test_serves_every_generic_document(self, client: TestClient, key):
        assert client.get(f"/api/documents/{key}").status_code == 200

    @pytest.mark.parametrize("key", ["mutual-nda", "nope", "..%2Fcatalog"])
    def test_unknown_documents_and_the_nda_are_404(self, client: TestClient, key):
        assert client.get(f"/api/documents/{key}").status_code == 404
