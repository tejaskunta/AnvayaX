# Scheduled refresh (continual-learning loop)

The refresh is a **script, not a daemon** — one less thing to break during a
demo, and the Model Insight screen shows exactly when the last refresh ran.

## Weekly (matches REFRESH_INTERVAL_DAYS=7 in ml-service/model/config.py)

```cron
# crontab -e — every Monday 02:00, web app + ML service must be running
0 2 * * 1 cd /absolute/path/to/AnvayaX/web && PATH=$PWD/node_modules/.bin:$PATH node --import tsx scripts/refresh.ts >> /tmp/anvayax-refresh.log 2>&1
```

## What one refresh does

1. Assembles the replay pool: every gold row in the DB (L3 synthetic +
   reviewer corrections override model tiers) minus the frozen regression set.
2. `POST /train` on the ML service → LoRA **challenger trained from base**
   (never incremental on the old adapter), evaluated against the champion on
   the 52-row frozen gate.
3. **Gate:** challenger promoted only if SIF-potential recall doesn't drop
   more than 2pp. Rejected challengers still get a registry row (auditable
   trajectory, rollback = repoint `model_config.json`).
4. On promotion: exemplar store rebuilt from the new train pool, all 750+
   reports reclassified under the new champion, site aggregates recomputed,
   registry mirrored into sqlite, reviewer corrections re-applied on top.

## Manual trigger (demo path)

```bash
cd web
node_modules/.bin/tsx scripts/refresh.ts            # full refresh
node_modules/.bin/tsx scripts/refresh.ts --dry-run  # pool report only
```

## Exporting reviewer labels separately

```bash
node_modules/.bin/tsx scripts/export_corrections.ts
# -> ml-service/labeling/corrections_export.csv (also flips released_to_pool=1)
```
