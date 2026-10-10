"""Pre-fetch answers into data/insights_seed.json, then COMMIT that file (run from the backend folder):
   python -m scripts.prefetch_insights --limit 10 --match "National Institute of Technology"
Review the numbers against the official pages before committing: these become instant, never-expiring answers."""
import argparse
import time

import engine
import insights_router as ir


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--match", default="")
    a = ap.parse_args()
    client = ir._client()
    if client is None:
        raise SystemExit("Set TINYFISH_API_KEY first.")
    names = [n for n in sorted(engine.df_master["institute"].dropna().unique()) if a.match.lower() in n.lower()][: a.limit]
    seeded = ir._read(ir.SEED_PATH)
    for n in names:
        if n in seeded:
            print("already seeded", n)
            continue
        try:
            rec = ir.fetch_blocking(client, n)
        except Exception as e:  # keep going: one bad page should not stop the batch
            print("error         ", n, type(e).__name__)
            continue
        if rec and rec["status"] == "ok":
            ir._cache_put(n, rec, ir.SEED_PATH)
        print((rec or {"status": "failed"})["status"].ljust(14), n)
        time.sleep(1)


if __name__ == "__main__":
    main()
