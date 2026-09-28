# Saturday Scoreboard

Weekly college football betting card — picks, results, and running profitability.

Live: https://lucasmilbank1.github.io/saturday-scoreboard/

## How it works

This repo holds only the **rendered card**. The model, scrapers, and raw data stay local
and are not published here.

| File | Role |
|---|---|
| `index.html` | Shell — header, tab container, panel templates |
| `styles.css` | Presentation |
| `app.js` | Renderer. Builds tabs, tickets, slicers and charts entirely from the feed |
| `data/weeks.json` | **The only file that changes weekly** |

Nothing about a given week is hardcoded in the renderer. Tabs, the week→label map,
profitability slicers and the breakdown rows are all derived from whichever weeks appear
in `weeks.json`. Adding a week is a JSON write, never a markup edit.

## Feed shape

```jsonc
{
  "season": 2026,
  "updated": "2026-10-03T09:05:00Z",
  "model_version": "v7",
  "model_changelog": [ { "version": "v7", "date": "...", "note": "..." } ],
  "weeks": [
    {
      "week": 4,
      "label": "Week 4",
      "date": "2026-09-26",
      "tickets": [
        {
          "id": "week4-vt-bc",
          "matchup": "Virginia Tech at Boston College",
          "venue": "Alumni Stadium, Chestnut Hill",
          "kickoff": "Sat Sept 26 · 3:30 PM ET",
          "bet_type": "Spread",
          "pick": "Boston College +14",
          "odds": -108,          // American
          "wager": 25,
          "result": "Pending",   // Win | Loss | Push | Pending
          "tier": "bet",         // bet | lean
          "colors": ["#861F41", "#8C2232"],
          "why": "…",
          "trend": "…"
        }
      ],
      "parlays": []
    }
  ]
}
```

`Push` returns the stake: it counts as neither a win nor a loss and contributes $0 profit.
The legacy artifact had no push branch and rendered them as Pending.

## Grading

Flip `result` on a settled ticket. Everything downstream — status pill, to-win,
profit/loss, week record, ROI, both charts — recomputes from that one field.
