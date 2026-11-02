# Momentum on real crypto (1-minute candles)

Choices ranked on Bitcoin's first 80% (train + validation):

| N candles | Close within | Win rate (first 80%) | Trades |
|---|---|---|---|
| 5 | top/bottom 0% of the range | 55.5% | 4,363 |
| 30 | top/bottom 0% of the range | 55.2% | 1,541 |
| 10 | top/bottom 0% of the range | 54.7% | 2,972 |
| 20 | top/bottom 0% of the range | 54.7% | 1,975 |
| 14 | top/bottom 0% of the range | 54.3% | 2,452 |
| 5 | top/bottom 5% of the range | 53.6% | 11,399 |
| 60 | top/bottom 0% of the range | 53.3% | 968 |
| 10 | top/bottom 5% of the range | 53.2% | 9,168 |

Chosen: N = 5, close within the top/bottom 0% of the range.

| Data | Never seen when choosing? | Win rate (trades; 95% CI; per day) |
|---|---|---|
| BTC/USD (real), last 20% | yes | **59.8%** (1,633; 57.4-62.1%; 267/day) |
| ETHUSD | yes | **53.2%** (3,309; 51.5-54.9%; 108/day) |
| XRPUSD | yes | **50.5%** (9,656; 49.5-51.5%; 316/day) |
| EURUSD | yes | **48.8%** (2,715; 46.9-50.6%; 60/day) |
| EURUSD-OTC | yes | **50.3%** (3,714; 48.7-51.9%; 61/day) |
| GBPUSD-OTC | yes | **50.6%** (3,342; 48.9-52.3%; 74/day) |
| BTCUSD-OTC | yes | **48.0%** (2,387; 46.0-50.0%; 53/day) |
| ETHUSD-OTC | yes | **51.3%** (2,431; 49.3-53.2%; 54/day) |
| CARDANO-OTC | yes | **49.0%** (2,307; 46.9-51.0%; 51/day) |

Realistic entry check on the 7 days with 5-second candles (same arrows):

- entry at the candle open: **59.8%** (1,824; 57.5-62.0%; 260/day)
- entry 5 s after the open (the extension buys about 1.5-3 s after it): **58.0%** (1,818; 55.7-60.2%; 260/day)
