import sys
import types

import pytest
from fastapi.testclient import TestClient

import insights_router as ir

GOOD = {"mains_rank": 8500, "advanced_rank": None, "category": "OPEN", "quota": "All India (AI)", "gender": "Gender-Neutral", "preferred_branch": " Computer Science "}


def build(monkeypatch, tmp_path, csv=None):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    fake = types.ModuleType("engine"); fake.calls = []; fake.exc = None
    def optimize_choices(**kw):
        fake.calls.append(kw)
        if fake.exc: raise fake.exc
        return [{"institute": "NIT Trichy", "branch": "CSE"}]
    fake.optimize_choices = optimize_choices
    monkeypatch.setitem(sys.modules, "engine", fake)
    monkeypatch.delitem(sys.modules, "main", raising=False)
    ir._KNOWN = None
    import main
    monkeypatch.setattr(main, "BUNDLE_PATH", str(tmp_path / "none.pkl"))
    p = tmp_path / "cutoffs.csv"
    if csv: p.write_text(csv)
    monkeypatch.setattr(main, "DATA_PATH", str(p))
    return main, fake


@pytest.fixture
def empty(monkeypatch, tmp_path):
    main, fake = build(monkeypatch, tmp_path)
    with TestClient(main.app) as c:
        yield c, fake, main


@pytest.fixture
def loaded(monkeypatch, tmp_path):
    main, fake = build(monkeypatch, tmp_path, "Institute,Branch\nNIT Trichy,CSE\nIIT Bombay,CSE\n")
    with TestClient(main.app) as c:
        yield c, fake, main


def test_health_and_503_without_dataset(empty):
    c, fake, _ = empty
    h = c.get("/health").json()
    assert h["dataset_loaded"] is False and h["catboost_loaded"] is False and "model_version" in h
    assert c.post("/api/optimize-choices", json=GOOD).status_code == 503 and fake.calls == []


def test_optimize_passes_the_exact_arguments_the_engine_expects(loaded):
    c, fake, _ = loaded
    assert c.get("/health").json()["dataset_loaded"] is True
    r = c.post("/api/optimize-choices", json=GOOD)
    assert r.status_code == 200 and r.json()[0]["institute"] == "NIT Trichy"
    kw = fake.calls[0]
    assert {"mains_rank", "advanced_rank", "category", "quota", "gender", "preferred_branch", "df", "model_bundle"} == set(kw)
    assert kw["advanced_rank"] is None and kw["preferred_branch"] == "Computer Science" and len(kw["df"]) == 2


@pytest.mark.parametrize("patch", [{"mains_rank": 0}, {"mains_rank": 5_000_000}, {"advanced_rank": 0}, {"preferred_branch": "x" * 121}, {"category": ""}])
def test_invalid_input_rejected_before_the_engine(loaded, patch):
    c, fake, _ = loaded
    assert c.post("/api/optimize-choices", json={**GOOD, **patch}).status_code == 422 and fake.calls == []


def test_engine_crash_is_generic_500(loaded):
    c, fake, _ = loaded
    fake.exc = RuntimeError("secret /srv/model.pkl")
    r = c.post("/api/optimize-choices", json=GOOD)
    assert r.status_code == 500 and "secret" not in r.text


def test_cors_exact_origins_only(loaded):
    c, _, _ = loaded
    ask = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    ok = c.options("/api/optimize-choices", headers={"Origin": "https://rankorra.vercel.app", **ask})
    assert ok.headers.get("access-control-allow-origin") == "https://rankorra.vercel.app"
    assert "access-control-allow-origin" not in c.options("/api/optimize-choices", headers={"Origin": "https://evil.example", **ask}).headers


def test_old_insights_route_is_gone_and_new_ones_exist(loaded):
    c, _, _ = loaded
    assert c.get("/api/insights", params={"institute": "NIT Trichy"}).status_code == 404
    assert c.get("/api/insights/health").status_code == 200


def test_only_dataset_institutes_can_start_a_paid_lookup(loaded, monkeypatch):
    c, _, _ = loaded
    monkeypatch.setenv("TINYFISH_API_KEY", "sk-tinyfish-test")
    assert c.post("/api/insights/start", json={"institute": "Random Corp"}).status_code == 404
