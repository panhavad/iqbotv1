# Deeper search (round 2)

Same data and time splits as results.md. All OTC assets unless stated.


## E1 - Learn which arrows of the current logic win (your idea)

| Asset | Arrows train / val / test | All arrows, test | Arrows the model trusts, test | 95% CI |
|---|---|---|---|---|
| EURUSD-OTC | 10973 / 3669 / 3639 | 50.3% | **46.3%** (525 arrows) | 42.1-50.6% |
| GBPUSD-OTC | 8026 / 2718 / 2712 | 50.7% | **57.5%** (351 arrows) | 52.3-62.6% |
| CARDANO-OTC | 8149 / 2724 / 2806 | 49.0% | **48.2%** (1394 arrows) | 45.6-50.8% |
| ETHUSD-OTC | 8192 / 2716 / 2789 | 49.6% | **49.1%** (481 arrows) | 44.6-53.5% |
| BTCUSD-OTC | 8292 / 2697 / 2686 | 48.1% | **49.6%** (643 arrows) | 45.8-53.5% |
| **All OTC assets** | | 49.6% (14632) | **49.3%** (3394 arrows) | 47.6-50.9% |

## E2 - One model trained on all OTC assets together

Training rows: 206,535. Confidence cut chosen on validation: top 5% of candles.

| Asset | Validation | **Test (unseen)** | Test 95% CI |
|---|---|---|---|
| EURUSD-OTC |  51.4% (   671) | ** 50.4% (   720)** | 46.8-54.1% |
| GBPUSD-OTC |  51.8% (   581) | ** 50.9% (   462)** | 46.3-55.4% |
| CARDANO-OTC |  51.8% (   738) | ** 49.6% (   697)** | 45.9-53.3% |
| ETHUSD-OTC |  47.7% (   665) | ** 49.9% (   741)** | 46.3-53.5% |
| BTCUSD-OTC |  50.5% (   857) | ** 50.8% (   598)** | 46.8-54.8% |
| **All** | | **50.3% (3218)** | 48.6-52.0% |

## E3 - Walk-forward on EURUSD-OTC: retrain every day on the previous 14 days

47 trading days, the most confident 5% of candles traded each day: **49.4% won** over 3,543 trades (95% CI 47.7-51.0%). Best day 73%, worst day 33%, days above 53.2%: 14 of 47.

## E4 - Massive rule search on EURUSD-OTC: 150,000 combinations of 2-4 conditions

| Rules selected by their past (training) win rate | How many | Past win rate | Validation | **Test (unseen)** |
|---|---|---|---|---|
| 90% or more on 10+ past trades | 32 | 92.2% | 48.7% (113) | **51.3% (115)** |
| 70% or more on 30+ past trades | 143 | 72.5% | 49.0% (1,891) | **49.1% (2,017)** |
| 60% or more on 100+ past trades | 290 | 61.4% | 48.3% (13,627) | **47.8% (14,580)** |
| 55% or more on 300+ past trades | 400 | 56.4% | 47.7% (55,671) | **48.7% (58,475)** |
| Top 20 by past win rate (100+ trades) | 20 | 65.0% | 46.6% (852) | **43.8% (1,053)** |

82,986 of the 150,000 combinations had 10+ trades in the training period.

## E3 - Walk-forward on BTCUSD: retrain every day on the previous 10 days

21 trading days, the most confident 5% of candles traded each day: **57.6% won** over 1,237 trades (95% CI 54.9-60.4%). Best day 68%, worst day 43%, days above 53.2%: 16 of 21.
