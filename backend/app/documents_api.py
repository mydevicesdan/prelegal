from fastapi import APIRouter, HTTPException

from app.documents import get_spec
from app.schemas import WireModel

router = APIRouter(prefix="/api")


class FieldOut(WireModel):
    key: str
    label: str
    source: str
    context: str


class DocumentOut(WireModel):
    """Everything the frontend needs to render a generic (non-NDA) document."""

    key: str
    name: str
    parties: list[str]
    fields: list[FieldOut]
    terms: str


@router.get("/documents/{key}", response_model=DocumentOut, response_model_by_alias=True)
def document(key: str) -> DocumentOut:
    spec = get_spec(key)
    if spec is None:
        raise HTTPException(404, "Unknown document.")
    return DocumentOut(
        key=spec.key,
        name=spec.name,
        parties=list(spec.parties),
        fields=[FieldOut(key=f.key, label=f.label, source=f.source, context=f.context) for f in spec.fields],
        terms=spec.terms,
    )
