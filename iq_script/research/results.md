# Signal research results

Win rate of the arrows on the next 1-minute candle (ties left out), by time period. Break-even: 53.2% at an 88% payout, 51.3% at 95%.


## BTCUSD: 44,000 candles, 31 days, ties 0.6%, up candles 50.3%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  51.6% ( 26071) |  51.5% (  8726) | ** 53.4% (  8599)** | 52.3-54.4% | 1407 |
| Reverse the last candle |  48.4% ( 26071) |  48.5% (  8726) | ** 46.6% (  8599)** | 45.6-47.7% | 1407 |
| Current logic (default rules) |  52.4% (  1271) |  49.9% (   415) | ** 54.5% (   429)** | 49.8-59.2% | 70 |
| Current logic, loose (0.15 / 2) |  51.5% (  5392) |  50.6% (  1861) | ** 54.5% (  1925)** | 52.3-56.7% | 315 |
| Current logic, strict (0.5 / 5) |  55.0% (    40) |  37.5% (     8) | ** 61.1% (    18)** | 38.6-79.7% | 3 |
| Best single rule on train: `pos30 >= 1 -> CALL` |  57.1% (   525) |  55.6% (   205) | ** 56.7% (   263)** | 50.6-62.5% | 43 |
| Best single rule on train: `r20 >= 8.967 -> CALL` |  56.9% (   524) |  43.6% (    94) | ** 54.6% (   130)** | 46.0-62.9% | 21 |
| Best single rule on train: `stoch14 >= 100 -> CALL` |  55.8% (   808) |  55.7% (   348) | ** 60.0% (   438)** | 55.4-64.5% | 72 |
| Best single rule on validation: `lower >= 0.6163 -> CALL` |  51.6% (  1313) |  60.7% (   412) | ** 50.6% (   399)** | 45.7-55.5% | 65 |
| Best single rule on validation: `lower >= 0.8792 -> CALL` |  50.2% (   526) |  60.4% (   139) | ** 52.9% (   153)** | 45.1-60.7% | 25 |
| Best single rule on validation: `pos30 <= 0 -> PUT` |  51.7% (   545) |  58.1% (   291) | ** 59.1% (   279)** | 53.3-64.7% | 46 |
| Colour pattern of last 3 candles (margin 0.03) |  53.5% (  6335) |  52.5% (  2176) | ** 52.0% (  2122)** | 49.9-54.1% | 347 |
| Logistic regression (45 features, confidence >= 0.540) |  55.9% (  6294) |  55.7% (  2043) | ** 54.9% (  2010)** | 52.7-57.1% | 329 |
| Gradient boosting (45 features, confidence >= 0.545) |  67.8% (   804) |  63.4% (   205) | ** 57.6% (   243)** | 51.3-63.7% | 40 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## BTCUSD-OTC: 65,000 candles, 45 days, ties 0.0%, up candles 50.0%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  49.9% ( 38853) |  49.8% ( 12991) | ** 49.6% ( 12990)** | 48.7-50.4% | 1434 |
| Reverse the last candle |  50.1% ( 38853) |  50.2% ( 12991) | ** 50.4% ( 12990)** | 49.6-51.3% | 1434 |
| Current logic (default rules) |  49.6% (  1673) |  45.5% (   532) | ** 46.7% (   533)** | 42.5-51.0% | 59 |
| Current logic, loose (0.15 / 2) |  49.6% (  8292) |  50.3% (  2697) | ** 48.1% (  2686)** | 46.3-50.0% | 296 |
| Current logic, strict (0.5 / 5) |  56.7% (    30) |   0.0% (     6) | ** 40.0% (    10)** | 16.8-68.7% | 1 |
| Best single rule on train: `bb_pos <= -1.186 -> CALL` |  55.0% (   778) |  52.7% (   264) | ** 48.0% (   279)** | 42.2-53.9% | 31 |
| Best single rule on train: `r3 <= -2.515 -> CALL` |  54.4% (   778) |  51.8% (   274) | ** 53.6% (   235)** | 47.2-59.9% | 26 |
| Best single rule on train: `bb_pos <= -1.03 -> CALL` |  54.0% (  1943) |  53.1% (   691) | ** 51.1% (   663)** | 47.3-54.9% | 73 |
| Best single rule on validation: `d_ema21 <= -3.333 -> CALL` |  51.8% (   778) |  57.5% (   280) | ** 49.4% (   312)** | 43.9-54.9% | 34 |
| Best single rule on validation: `pos30 <= 0.002597 -> CALL` |  51.5% (   778) |  56.7% (   307) | ** 49.2% (   246)** | 43.0-55.4% | 27 |
| Best single rule on validation: `pos10 <= 1.112e-05 -> CALL` |  51.9% (   778) |  55.8% (   240) | ** 55.9% (   204)** | 49.0-62.5% | 23 |
| Colour pattern of last 5 candles (margin 0.02) |  52.3% (  2473) |  50.4% (   786) | ** 48.9% (   836)** | 45.5-52.3% | 92 |
| Logistic regression (45 features, confidence >= 0.537) |  57.3% (   733) |  52.5% (   259) | ** 54.2% (   168)** | 46.6-61.5% | 19 |
| Gradient boosting (45 features, confidence >= 0.510) |  60.8% (  2381) |  50.3% (   862) | ** 51.4% (   764)** | 47.9-55.0% | 84 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## CARDANO-OTC: 65,000 candles, 45 days, ties 0.1%, up candles 50.3%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  50.1% ( 38751) |  50.1% ( 12977) | ** 50.0% ( 12961)** | 49.1-50.8% | 1431 |
| Reverse the last candle |  49.9% ( 38751) |  49.9% ( 12977) | ** 50.0% ( 12961)** | 49.2-50.9% | 1431 |
| Current logic (default rules) |  49.7% (  1543) |  48.6% (   498) | ** 46.9% (   520)** | 42.7-51.2% | 57 |
| Current logic, loose (0.15 / 2) |  49.4% (  8149) |  49.5% (  2724) | ** 49.0% (  2806)** | 47.2-50.9% | 310 |
| Current logic, strict (0.5 / 5) |  48.3% (    29) |  60.0% (    10) | ** 21.4% (    14)** | 7.6-47.6% | 2 |
| Best single rule on train: `lower >= 0.7394 -> CALL` |  55.0% (   778) |  55.4% (   231) | ** 47.0% (   302)** | 41.5-52.7% | 33 |
| Best single rule on train: `body2 >= 1.392 -> CALL` |  53.5% (   778) |  51.2% (   248) | ** 49.2% (   250)** | 43.1-55.4% | 28 |
| Best single rule on train: `atr_ratio >= 1.289 -> PUT` |  53.1% (   776) |  51.5% (   202) | ** 46.3% (   162)** | 38.8-54.0% | 18 |
| Best single rule on validation: `d_ema21 <= -3.061 -> CALL` |  51.2% (   776) |  57.9% (   190) | ** 52.2% (   224)** | 45.7-58.7% | 25 |
| Best single rule on validation: `slope21 <= -0.8947 -> CALL` |  50.9% (   776) |  57.8% (   180) | ** 51.8% (   218)** | 45.2-58.4% | 24 |
| Best single rule on validation: `di <= -25.19 -> CALL` |  50.6% (   776) |  56.8% (   185) | ** 51.9% (   266)** | 45.9-57.8% | 29 |
| Colour pattern of last 4 candles (margin 0.01) |  51.4% ( 12172) |  49.8% (  4113) | ** 48.7% (  4071)** | 47.2-50.3% | 449 |
| Logistic regression (45 features, confidence >= 0.535) |  54.7% (   946) |  54.2% (   323) | ** 48.8% (   344)** | 43.6-54.1% | 38 |
| Gradient boosting (45 features, confidence >= 0.522) |  64.7% (  1109) |  53.6% (   334) | ** 47.6% (   395)** | 42.7-52.5% | 44 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## ETHUSD-OTC: 65,000 candles, 45 days, ties 0.0%, up candles 49.9%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  50.1% ( 38851) |  49.4% ( 12989) | ** 49.1% ( 12986)** | 48.3-50.0% | 1433 |
| Reverse the last candle |  49.9% ( 38851) |  50.6% ( 12989) | ** 50.9% ( 12986)** | 50.0-51.7% | 1433 |
| Current logic (default rules) |  51.5% (  1605) |  52.1% (   514) | ** 48.9% (   630)** | 45.0-52.8% | 70 |
| Current logic, loose (0.15 / 2) |  50.9% (  8192) |  50.4% (  2716) | ** 49.6% (  2789)** | 47.8-51.5% | 308 |
| Current logic, strict (0.5 / 5) |  42.1% (    38) |  91.7% (    12) | ** 47.1% (    17)** | 26.2-69.0% | 2 |
| Best single rule on train: `atr_ratio <= 0.8244 -> CALL` |  53.7% (   778) |  48.5% (   340) | ** 46.3% (   367)** | 41.3-51.4% | 41 |
| Best single rule on train: `bb_width >= 10.26 -> PUT` |  53.1% (   778) |  48.3% (   269) | ** 51.4% (   325)** | 46.0-56.8% | 36 |
| Best single rule on train: `d_ema100 >= 9.315 -> CALL` |  53.0% (   778) |  54.9% (   113) | ** 50.8% (   266)** | 44.8-56.7% | 29 |
| Best single rule on validation: `r20 >= 6.586 -> PUT` |  50.3% (   777) |  56.5% (   253) | ** 47.3% (   281)** | 41.6-53.2% | 31 |
| Best single rule on validation: `r3 >= 2.422 -> CALL` |  51.9% (   778) |  55.3% (   313) | ** 48.1% (   266)** | 42.2-54.1% | 29 |
| Best single rule on validation: `rsi2 <= 1.267 -> CALL` |  50.1% (   778) |  55.0% (   238) | ** 46.1% (   323)** | 40.8-51.6% | 36 |
| Colour pattern of last 5 candles (margin 0.02) |  52.3% (  7204) |  50.8% (  2512) | ** 49.1% (  2495)** | 47.2-51.1% | 275 |
| Logistic regression (45 features, confidence >= 0.525) |  51.7% (  1727) |  52.2% (   627) | ** 46.3% (   596)** | 42.3-50.3% | 66 |
| Gradient boosting (45 features, confidence >= 0.512) |  59.1% (  1444) |  53.4% (   491) | ** 51.2% (   514)** | 46.9-55.5% | 57 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## EURUSD: 45,000 candles, 45 days, ties 5.4%, up candles 49.7%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  49.5% ( 24042) |  49.1% (  8170) | ** 48.8% (  8129)** | 47.8-49.9% | 897 |
| Reverse the last candle |  50.5% ( 24042) |  50.9% (  8170) | ** 51.2% (  8129)** | 50.1-52.2% | 897 |
| Current logic (default rules) |  50.2% (  1107) |  52.1% (   340) | ** 48.3% (   323)** | 42.9-53.7% | 36 |
| Current logic, loose (0.15 / 2) |  49.2% (  5536) |  47.7% (  1827) | ** 51.3% (  1729)** | 48.9-53.7% | 191 |
| Current logic, strict (0.5 / 5) |  69.7% (    33) |  25.0% (     4) | ** 61.5% (    13)** | 35.5-82.3% | 1 |
| Best single rule on train: `atr_ratio <= 0.5436 -> PUT` |  57.8% (   431) |  58.7% (    46) | ** 51.8% (   139)** | 43.6-59.9% | 15 |
| Best single rule on train: `r1 >= 1.541 -> CALL` |  55.7% (   512) |  48.4% (   161) | ** 44.5% (   146)** | 36.7-52.6% | 16 |
| Best single rule on train: `body >= 1.527 -> CALL` |  55.6% (   513) |  47.9% (   165) | ** 46.1% (   152)** | 38.3-54.0% | 17 |
| Best single rule on validation: `pos60 >= 0.986 -> CALL` |  53.1% (   514) |  58.9% (   207) | ** 47.8% (   184)** | 40.7-55.0% | 20 |
| Best single rule on validation: `rsi7 <= 14.83 -> PUT` |  53.4% (   513) |  57.7% (   149) | ** 50.9% (   159)** | 43.2-58.6% | 18 |
| Best single rule on validation: `d_ema21 <= -3.468 -> PUT` |  51.2% (   508) |  56.8% (   132) | ** 51.4% (   144)** | 43.3-59.4% | 16 |
| Colour pattern of last 3 candles (margin 0.02) |  52.1% (  2671) |  53.4% (   937) | ** 47.5% (   905)** | 44.3-50.8% | 100 |
| Logistic regression (45 features, confidence >= 0.550) |  58.8% (   575) |  53.0% (   181) | ** 50.0% (   160)** | 42.3-57.7% | 18 |
| Gradient boosting (45 features, confidence >= 0.515) |  58.9% (  1036) |  51.2% (   342) | ** 54.5% (   334)** | 49.1-59.8% | 37 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## EURUSD-OTC: 87,124 candles, 61 days, ties 0.9%, up candles 50.0%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  50.2% ( 51165) |  50.2% ( 17120) | ** 49.8% ( 17113)** | 49.1-50.6% | 1409 |
| Reverse the last candle |  49.8% ( 51165) |  49.8% ( 17120) | ** 50.2% ( 17113)** | 49.4-50.9% | 1409 |
| Current logic (default rules) |  50.5% (  2100) |  49.4% (   716) | ** 52.3% (   654)** | 48.5-56.1% | 54 |
| Current logic, loose (0.15 / 2) |  50.2% ( 10973) |  48.9% (  3669) | ** 50.3% (  3639)** | 48.7-51.9% | 300 |
| Current logic, strict (0.5 / 5) |  44.1% (    59) |  66.7% (    15) | ** 43.8% (    16)** | 23.1-66.8% | 1 |
| Best single rule on train: `rsi2 >= 98.62 -> PUT` |  54.4% (  1038) |  47.3% (   410) | ** 46.5% (   430)** | 41.8-51.2% | 35 |
| Best single rule on train: `bb_pos >= 1.195 -> PUT` |  53.6% (  1035) |  47.0% (   368) | ** 48.2% (   380)** | 43.2-53.2% | 31 |
| Best single rule on train: `slope21 <= -0.8725 -> CALL` |  53.4% (  1033) |  48.1% (   310) | ** 46.2% (   429)** | 41.5-50.9% | 35 |
| Best single rule on validation: `adx <= 10.84 -> PUT` |  51.3% (  1029) |  56.7% (   247) | ** 45.6% (   439)** | 41.0-50.2% | 36 |
| Best single rule on validation: `gap <= -0.1075 -> CALL` |  51.8% (  1030) |  55.9% (   338) | ** 49.1% (   336)** | 43.8-54.4% | 28 |
| Best single rule on validation: `adx <= 12.1 -> PUT` |  50.6% (  2579) |  55.1% (   650) | ** 47.7% (   979)** | 44.6-50.8% | 81 |
| Colour pattern of last 3 candles (margin 0.01) |  51.1% (  6273) |  49.8% (  2084) | ** 51.0% (  2084)** | 48.9-53.2% | 172 |
| Logistic regression (45 features, confidence >= 0.500) |  51.0% ( 51639) |  50.1% ( 17266) | ** 49.8% ( 17262)** | 49.0-50.5% | 1422 |
| Gradient boosting (45 features, confidence >= 0.500) |  52.3% ( 51639) |  50.0% ( 17266) | ** 50.1% ( 17262)** | 49.4-50.9% | 1422 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).

## GBPUSD-OTC: 65,000 candles, 45 days, ties 1.2%, up candles 49.6%

| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |
|---|---|---|---|---|---|
| Follow the last candle |  50.4% ( 37910) |  49.9% ( 12687) | ** 50.4% ( 12674)** | 49.5-51.2% | 1403 |
| Reverse the last candle |  49.6% ( 37910) |  50.1% ( 12687) | ** 49.6% ( 12674)** | 48.8-50.5% | 1403 |
| Current logic (default rules) |  51.6% (  1484) |  48.8% (   492) | ** 51.3% (   497)** | 46.9-55.7% | 55 |
| Current logic, loose (0.15 / 2) |  50.2% (  8026) |  51.4% (  2718) | ** 50.7% (  2712)** | 48.8-52.6% | 300 |
| Current logic, strict (0.5 / 5) |  53.6% (    28) |  60.0% (    10) | ** 37.5% (    16)** | 18.5-61.4% | 2 |
| Best single rule on train: `streak == -4 -> PUT` |  53.8% (  1167) |  48.9% (   440) | ** 46.0% (   413)** | 41.3-50.8% | 46 |
| Best single rule on train: `c5 == 0 -> CALL` |  53.4% (   479) |  53.2% (   154) | ** 50.9% (   161)** | 43.3-58.5% | 18 |
| Best single rule on train: `r3 <= -2.35 -> PUT` |  53.4% (   773) |  51.6% (   275) | ** 50.5% (   275)** | 44.7-56.4% | 30 |
| Best single rule on validation: `d_ema21 >= 2.976 -> PUT` |  52.9% (   766) |  60.4% (   227) | ** 51.4% (   253)** | 45.3-57.5% | 28 |
| Best single rule on validation: `rsi14 >= 73.82 -> PUT` |  51.0% (   771) |  59.8% (   239) | ** 48.9% (   266)** | 42.9-54.9% | 29 |
| Best single rule on validation: `slope21 >= 0.8519 -> PUT` |  52.5% (   770) |  59.2% (   245) | ** 49.1% (   265)** | 43.1-55.0% | 29 |
| Colour pattern of last 2 candles (margin 0.01) |  51.1% (  9500) |  53.0% (  3292) | ** 50.0% (  3192)** | 48.2-51.7% | 353 |
| Logistic regression (45 features, confidence >= 0.530) |  55.7% (  1380) |  54.6% (   526) | ** 51.3% (   431)** | 46.6-56.0% | 48 |
| Gradient boosting (45 features, confidence >= 0.515) |  62.7% (   906) |  53.3% (   338) | ** 47.8% (   270)** | 41.9-53.7% | 30 |

**Searching for a 90% rule (what was asked):** 12,000 random combinations of 2-3 conditions were tried on the training candles; 0 reached 90% or more there (each with at least 30 trades).
