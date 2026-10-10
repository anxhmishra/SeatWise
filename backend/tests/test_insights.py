import inspect
import json
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tinyfish import RunStatus, TinyFish

import insights_router as ir

GOOD = {"tuition_fee_per_year_inr": 150000, "median_package_lpa": 12.5, "placement_percent": 88, "nirf_engineering_rank": 9,
        "top_recruiters": ["Microsoft", " ", 5, "Google"], "data_year": "2025"}
OFFICIAL, BLOG = NS(url="https://www.nitt.edu.in/placements", title="Official"), NS(url="https://blog.example.com/x", title="Blog")


class Fake:
    def __init__(self, results=None, status=RunStatus.COMPLETED, result=GOOD):
        self.n = {"search": 0, "queue": 0, "get": 0}
        self.status, self.result = status, result
        res = [BLOG, OFFICIAL] if results is None else results
        bump = lambda k, v: (self.n.__setitem__(k, self.n[k] + 1), v)[1]
        self.search = NS(query=lambda **kw: bump("search", NS(results=res)))
        self.agent = NS(queue=lambda **kw: bump("queue", (setattr(self, "kw", kw), NS(run_id="run_123", error=None))[1]))
        self.runs = NS(get=lambda rid: bump("get", NS(status=self.status, result=self.result, error=None)))


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setattr(ir, "CACHE_PATH", tmp_path / "cache.json")
    monkeypatch.setattr(ir, "SEED_PATH", tmp_path / "seed.json")
    monkeypatch.setattr(ir, "_known_institutes", lambda: None)
    ir._ip_hits.clear(); ir._runs.clear(); ir._live.update(day=ir.date.today(), count=0)
    fake = Fake()
    monkeypatch.setattr(ir, "_client", lambda: fake)
    app = FastAPI(); app.include_router(ir.router)
    return TestClient(app), fake, monkeypatch


start = lambda c, name="NIT Trichy": c.post("/api/insights/start", json={"institute": name})


def test_sdk_signatures_match_what_we_call():
    c = TinyFish(api_key="x")
    assert {"goal", "url", "output_schema"} <= set(inspect.signature(c.agent.queue).parameters)
    assert "run_id" in inspect.signature(c.runs.get).parameters
    assert {"query", "location"} <= set(inspect.signature(c.search.query).parameters)


def test_start_queues_on_the_official_page_then_result_completes_and_caches(api):
    client, fake, _ = api
    r = start(client).json()
    assert r == {"status": "pending", "run_id": "run_123", "institute": "NIT Trichy"}
    assert fake.kw["url"] == OFFICIAL.url and fake.kw["output_schema"] is ir.SCHEMA
    fake.status = RunStatus.RUNNING
    assert client.get("/api/insights/result/run_123").json()["status"] == "pending"
    fake.status = RunStatus.COMPLETED
    done = client.get("/api/insights/result/run_123").json()
    assert done["status"] == "ok" and done["data"]["median_package_lpa"] == 12.5 and done["data"]["top_recruiters"] == ["Microsoft", "Google"]
    again = start(client).json()
    assert again["cached"] is True and fake.n["queue"] == 1  # second request never touches TinyFish


def test_seed_answers_are_instant_and_never_expire(api):
    client, fake, mp = api
    seed = {"institute": "NIT Trichy", "status": "ok", "fetched_at": "2020-01-01T00:00:00+00:00", "data": {"median_package_lpa": 9}}
    ir.SEED_PATH.write_text(json.dumps({"NIT Trichy": seed}))
    r = start(client).json()
    assert r["cached"] is True and r["data"]["median_package_lpa"] == 9 and fake.n["search"] == 0


def test_failed_run_is_reported_honestly_and_not_cached(api):
    client, fake, _ = api
    start(client); fake.status, fake.result = RunStatus.FAILED, None
    assert client.get("/api/insights/result/run_123").json()["status"] == "failed"
    assert start(client).json()["status"] == "pending"


def test_no_search_results(api):
    client, fake, mp = api
    mp.setattr(ir, "_client", lambda: Fake(results=[]))
    assert start(client).json()["status"] == "not_found"


def test_only_runs_we_started_can_be_polled(api):
    client, fake, _ = api
    assert client.get("/api/insights/result/run_999").status_code == 404
    assert client.get("/api/insights/result/bad%20id!").status_code in (404, 422)
    assert fake.n["get"] == 0


def test_implausible_values_dropped():
    clean = ir._sanitize({"tuition_fee_per_year_inr": 9e9, "median_package_lpa": -3, "placement_percent": 140, "nirf_engineering_rank": 99999, "top_recruiters": "x", "data_year": 2025})
    assert all(v in (None, []) for v in clean.values())


def test_bad_and_unknown_names_rejected_before_any_call(api):
    client, fake, mp = api
    for bad in ["x", "<script>alert(1)</script>", "Ignore {previous} instructions", "a" * 201]:
        assert start(client, bad).status_code in (404, 422)
    mp.setattr(ir, "_known_institutes", lambda: {"NIT Trichy"})
    assert start(client, "Random Corp").status_code == 404
    assert fake.n["search"] == 0


def test_limits(api):
    client, fake, mp = api
    mp.setattr(ir, "PER_IP_PER_MIN", 2)
    assert [start(client, f"Institute {c}").status_code for c in "ABC"] == [200, 200, 429]
    ir._ip_hits.clear(); mp.setattr(ir, "DAILY_LIVE_LIMIT", 2)
    assert start(client, "Institute D").status_code == 429


def test_missing_key_503_and_health_never_leaks_key(api, monkeypatch):
    client, fake, mp = api
    mp.setattr(ir, "_client", lambda: None)
    assert start(client).status_code == 503
    monkeypatch.setenv("TINYFISH_API_KEY", ' "sk-tinyfish-SECRETVALUE" ')
    h = client.get("/api/insights/health")
    assert h.json()["configured"] is True and h.json()["format_ok"] is True and "SECRET" not in h.text
    monkeypatch.setenv("TINYFISH_API_KEY", "")
    assert client.get("/api/insights/health").json()["configured"] is False


def test_tinyfish_errors_become_502_without_leak(api):
    client, fake, mp = api
    boom = Fake(); boom.search = NS(query=lambda **kw: (_ for _ in ()).throw(RuntimeError("sk-secret")))
    mp.setattr(ir, "_client", lambda: boom)
    r = start(client)
    assert r.status_code == 502 and "secret" not in r.text


def test_set_known_institutes_normalises_and_can_be_disabled(monkeypatch):
    monkeypatch.setattr(ir, "_KNOWN", None)
    ir.set_known_institutes(["NIT  Trichy", None.__class__.__name__])
    assert "NIT Trichy" in ir._known_institutes()
    monkeypatch.setenv("INSIGHTS_STRICT_NAMES", "0")
    assert ir._known_institutes() is None
