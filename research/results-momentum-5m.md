# Momentum on real crypto (5-minute candles)

Choices ranked on Bitcoin's first 80% (train + validation):

| N candles | Close within | Win rate (first 80%) | Trades |
|---|---|---|---|
| 30 | top/bottom 0% of the range | 49.7% | 173 |
| 5 | top/bottom 0% of the range | 48.7% | 632 |
| 20 | top/bottom 0% of the range | 48.5% | 233 |
| 5 | top/bottom 20% of the range | 47.8% | 12,985 |
| 60 | top/bottom 20% of the range | 47.7% | 10,498 |
| 5 | top/bottom 5% of the range | 47.3% | 4,706 |
| 5 | top/bottom 10% of the range | 47.2% | 7,607 |
| 30 | top/bottom 20% of the range | 47.2% | 10,891 |

Chosen: N = 30, close within the top/bottom 0% of the range.

| Data | Never seen when choosing? | Win rate (trades; 95% CI; per day) |
|---|---|---|
| BTC/USD (real), last 20% | yes | **49.1%** (106; 39.7-58.4%; 4/day) |
| ETHUSD | yes | **48.8%** (383; 43.9-53.8%; 3/day) |
