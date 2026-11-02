# Momentum on real crypto (15-minute candles)

Choices ranked on Bitcoin's first 80% (train + validation):

| N candles | Close within | Win rate (first 80%) | Trades |
|---|---|---|---|
| 60 | top/bottom 20% of the range | 45.5% | 10,516 |
| 5 | top/bottom 20% of the range | 44.9% | 11,484 |
| 20 | top/bottom 0% of the range | 44.8% | 67 |
| 20 | top/bottom 20% of the range | 44.7% | 10,327 |
| 30 | top/bottom 20% of the range | 44.7% | 10,266 |
| 10 | top/bottom 20% of the range | 44.6% | 10,804 |
| 14 | top/bottom 20% of the range | 44.5% | 10,532 |
| 5 | top/bottom 10% of the range | 44.0% | 5,380 |

Chosen: N = 60, close within the top/bottom 20% of the range.

| Data | Never seen when choosing? | Win rate (trades; 95% CI; per day) |
|---|---|---|
| BTC/USD (real), last 20% | yes | **47.8%** (2,625; 45.9-49.8%; 35/day) |
| ETHUSD | yes | **45.7%** (12,255; 44.8-46.6%; 33/day) |
| EURUSD-OTC | yes | **49.1%** (17,680; 48.3-49.8%; 47/day) |
