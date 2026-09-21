from fastapi import APIRouter, Depends, HTTPException
from pydantic import ConfigDict

from app.deps import current_user
from app.documents import get_spec
from app.schemas import WireModel

router = APIRouter(prefix="/api")


class FieldOut(WireModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    source: str
    context: str


class DocumentOut(WireModel):
    """Everything the frontend needs to render a generic (non-NDA) document."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    name: str
    parties: list[str]
    fields: list[FieldOut]
    terms: str


@router.get("/documents/{key}", response_model=DocumentOut, response_model_by_alias=True, dependencies=[Depends(current_user)])
def document(key: str) -> DocumentOut:
    spec = get_spec(key)
    if spec is None:
        raise HTTPException(404, "Unknown document.")
    return DocumentOut.model_validate(spec)
