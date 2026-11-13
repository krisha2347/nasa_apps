from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Dict, List, Literal, Optional

from . import engine as E
from . import triage_chat as T
from .ingest import IngestError, from_csv
from .report import build_report
from .simulator import N_DAYS

app = FastAPI(title="AstroTwin API", version="2.0.0",
              description="Offline-first astronaut health monitoring: personal baselines, drift detection, explainable actions.")
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _eng(cid: str):
    if cid not in E._PEOPLE:
        raise HTTPException(404, "unknown crew member")
    return E.member(cid)


@app.get("/api/meta")
def meta():
    return E.meta()


@app.get("/api/bundle", summary="Everything the offline client needs in one cacheable payload")
def bundle():
    return E.bundle()


@app.get("/api/crew/{cid}/status/{day}")
def status(cid: str, day: int):
    return _eng(cid).status(day)


@app.get("/api/summary/{day}", summary="Crew overview: who needs attention, team strain")
def summary(day: int):
    return E.summary(min(max(day, 0), N_DAYS - 1))


@app.get("/api/earth-queue")
def earth_queue(upto: int = N_DAYS - 1):
    return E.earth_queue(upto)


@app.get("/api/crew/{cid}/report", response_class=PlainTextResponse, summary="Markdown report for the flight surgeon")
def report(cid: str, day: int = N_DAYS - 1):
    _eng(cid)
    return PlainTextResponse(build_report(cid, day), media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="astrotwin_{cid}_day{day}.md"'})


class CheckIn(BaseModel):
    crew_id: str
    symptoms: List[str] = []
    reaction_ms: Optional[float] = None
    mood: Optional[int] = Field(default=None, ge=1, le=5)


@app.post("/api/checkin")
def checkin(body: CheckIn):
    _eng(body.crew_id)
    return E.triage(body.crew_id, body.symptoms, body.reaction_ms, body.mood)


class SymptomChat(BaseModel):
    crew_id: Optional[str] = None
    answers: Dict[str, Literal["yes", "no", "unsure"]] = {}
    readings: Dict[Literal["sys", "dia", "pulse"], float] = {}


@app.post("/api/symptom-chat", summary="Guided symptom questions plus one cuff reading, turned into instructions")
def symptom_chat(body: SymptomChat):
    baseline = None
    if body.crew_id:
        baseline = _eng(body.crew_id).mean["rhr"]
    try:
        return T.evaluate(body.answers, body.readings, baseline)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


class ImportBody(BaseModel):
    name: str = Field(default="You", max_length=40)
    csv: str = Field(max_length=2_000_000)


@app.post("/api/import", summary="Add your own wearable CSV as a crew member")
def import_csv(body: ImportBody):
    try:
        df = from_csv(body.csv)
    except IngestError as exc:
        raise HTTPException(400, str(exc))
    person = E.add_custom_member(body.name.strip() or "You", df)
    return dict(person=person, days=len(df))


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "static", html=True), name="static")
