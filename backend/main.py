import logging
import os
from typing import Optional

import joblib
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine import optimize_choices
from insights_router import router as insights_router, set_known_institutes

load_dotenv()
log = logging.getLogger("rankorra")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # paths no longer depend on where the server is started from
DATA_PATH = os.path.join(BASE_DIR, "data", "cutoffsfinal.csv")
BUNDLE_PATH = os.path.join(BASE_DIR, "model_bundle.pkl")
MODEL_VERSION = os.getenv("MODEL_VERSION", "unversioned")  # bump on Render whenever the model changes

# Exact origins only. To allow a Vercel preview URL, set CORS_ORIGINS on Render to a comma-separated list.
DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "https://rankorra.vercel.app"]
ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",") if o.strip()]

app = FastAPI(
    title="Rankorra Backend API",
    description="JEE Choice Optimization Engine (CatBoost) with TinyFish-powered college insights",
    version="2.1.0",
)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.include_router(insights_router)  # /api/insights/start, /api/insights/result/{run_id}, /api/insights/health

df_cutoffs = pd.DataFrame()
model_bundle = None


@app.on_event("startup")
def load_assets():
    global df_cutoffs, model_bundle
    if os.path.exists(DATA_PATH):
        df_cutoffs = pd.read_csv(DATA_PATH, low_memory=False)
        df_cutoffs.rename(columns={c: str(c).strip().lower().replace(" ", "_") for c in df_cutoffs.columns}, inplace=True)
        log.warning("Loaded dataset: %d rows.", len(df_cutoffs))
        if "institute" in df_cutoffs.columns:
            set_known_institutes(df_cutoffs["institute"].dropna().unique())
    else:
        log.warning("%s not found.", DATA_PATH)

    if os.path.exists(BUNDLE_PATH):
        model_bundle = joblib.load(BUNDLE_PATH)  # only ever load files you created yourself
        log.warning("Loaded CatBoost model bundle.")
    else:
        log.warning("%s not found. Running in rule-based fallback mode.", BUNDLE_PATH)


class StudentProfile(BaseModel):
    mains_rank: int = Field(..., ge=1, le=2_000_000)
    advanced_rank: Optional[int] = Field(None, ge=1, le=500_000)
    category: str = Field(..., min_length=2, max_length=30)
    quota: str = Field(..., min_length=2, max_length=40)
    gender: str = Field(..., min_length=3, max_length=40)
    preferred_branch: str = Field("All Branches (Any Discipline)", max_length=120)


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "dataset_loaded": not df_cutoffs.empty,
        "catboost_loaded": model_bundle is not None,
        "model_version": MODEL_VERSION,
    }


@app.post("/api/optimize-choices")  # plain def: FastAPI runs it in a thread pool, so slow model work doesn't block other requests
def get_optimized_choices(profile: StudentProfile):
    if df_cutoffs.empty:
        raise HTTPException(status_code=503, detail="Cutoff dataset not available on the server.")
    try:
        return optimize_choices(
            mains_rank=profile.mains_rank,
            advanced_rank=profile.advanced_rank,
            category=profile.category,
            quota=profile.quota,
            gender=profile.gender,
            preferred_branch=profile.preferred_branch.strip(),
            df=df_cutoffs,
            model_bundle=model_bundle,
        )
    except Exception:
        log.exception("optimize_choices failed")  # details go to the logs, never to the client
        raise HTTPException(status_code=500, detail="Prediction failed. Please try again later.")
