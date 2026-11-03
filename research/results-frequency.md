# Round 5: more frequent arrows

67 assets, 1-minute candles: 5 OTC, 18 Forex, 3 Crypto, 41 Other. Each family is tuned on the oldest 60% of an asset's candles for a minimum share of candles with an arrow (coverage), compared on the next 20% and judged once on the newest 20% (the check). Cells: check win rate of all assets of the group together (arrows); **bold** when the lower end of its 95% range beats break-even (53.8% at an 86% payout). Coverage 25% is about 15 arrows an hour, 50% about 30, 90% about 54.

## OTC (5 assets)

| Family | Any coverage | At least 10% | 25% | 50% | 90% |
|---|---|---|---|---|---|
| Breakout (extension today: 2-30 candles, zone 0-30%) | 50.0% (33,133), 31/h | 50.0% (33,923), 31/h | 50.0% (33,923), 31/h | 50.0% (44,597), 41/h | - |
| Breakout, wider (1-30 candles, zone 0-50%) | 50.0% (48,789), 41/h | 49.9% (54,957), 42/h | 49.9% (54,957), 42/h | 49.8% (53,928), 43/h | 50.1% (69,050), 60/h |
| Candle colour (follow / fade) | 50.4% (40,566), 37/h | 50.4% (40,566), 37/h | 50.2% (51,000), 50/h | 50.1% (61,449), 59/h | 50.1% (68,724), 60/h |
| Streak of k candles (follow / fade) | 50.0% (21,799), 15/h | 50.0% (21,799), 15/h | 49.9% (34,038), 29/h | 49.9% (6,379), 29/h | - |
| Z-score vs moving average (revert / follow) | 50.0% (60,913), 48/h | 50.0% (60,913), 48/h | 50.0% (60,913), 48/h | 50.0% (60,913), 48/h | 49.9% (69,046), 60/h |
| RSI(2) (Connors) | 50.1% (55,210), 50/h | 50.1% (55,210), 50/h | 50.1% (55,210), 50/h | 50.2% (59,862), 50/h | 50.1% (69,050), 60/h |
| Time of day / minute of hour | 50.1% (48,071), 58/h | 50.1% (51,931), 58/h | 50.1% (51,931), 58/h | 50.1% (67,757), 59/h | 50.1% (67,757), 59/h |
| All rule families together (wider breakout + the rest) | 50.0% (60,383), 60/h | 50.0% (60,383), 60/h | 50.0% (60,383), 60/h | 50.0% (68,510), 60/h | 49.9% (69,050), 60/h |
| Logistic regression (18 features) | 49.9% (43,165), 35/h | 49.9% (43,165), 35/h | 49.9% (43,165), 35/h | 49.8% (45,756), 35/h | 50.0% (66,566), 60/h |
| Gradient boosting (18 features) | 49.9% (29,523), 25/h | 49.9% (29,523), 25/h | 50.0% (32,004), 25/h | 50.0% (45,777), 36/h | 50.0% (66,000), 58/h |
| Nearest neighbours (last 8 candles) | 49.9% (56,373), 56/h | 49.9% (56,373), 56/h | 49.9% (56,373), 56/h | 50.0% (59,236), 56/h | 50.0% (64,634), 56/h |

Assets whose own check (lower end of the 95% range) beats break-even, all rule families together:

- coverage any: none of 5
- coverage 10%+: none of 5
- coverage 25%+: none of 5
- coverage 50%+: none of 5
- coverage 90%+: none of 5

## Forex (18 assets)

| Family | Any coverage | At least 10% | 25% | 50% | 90% |
|---|---|---|---|---|---|
| Breakout (extension today: 2-30 candles, zone 0-30%) | 52.1% (19,030), 3/h | 51.3% (62,784), 16/h | 51.5% (83,147), 23/h | 51.0% (129,733), 39/h | - |
| Breakout, wider (1-30 candles, zone 0-50%) | 52.8% (23,820), 4/h | 51.6% (53,767), 15/h | 51.6% (78,581), 18/h | 51.1% (138,681), 40/h | 50.9% (211,981), 60/h |
| Candle colour (follow / fade) | 51.0% (101,786), 28/h | 51.0% (101,786), 28/h | 51.0% (124,436), 35/h | 50.9% (144,957), 36/h | 50.7% (205,251), 58/h |
| Streak of k candles (follow / fade) | 51.2% (76,764), 27/h | 51.2% (76,764), 27/h | 50.9% (98,459), 28/h | - | - |
| Z-score vs moving average (revert / follow) | 50.6% (98,354), 24/h | 50.6% (105,883), 31/h | 50.6% (118,455), 32/h | 50.5% (144,448), 32/h | 50.5% (211,645), 60/h |
| RSI(2) (Connors) | 50.9% (157,601), 50/h | 50.9% (157,601), 50/h | 51.0% (159,321), 50/h | 50.9% (174,553), 50/h | 50.8% (212,055), 60/h |
| Time of day / minute of hour | 50.2% (115,590), 21/h | 50.2% (126,441), 24/h | 50.2% (163,689), 59/h | 50.1% (209,099), 59/h | 50.1% (209,099), 59/h |
| All rule families together (wider breakout + the rest) | 52.5% (26,672), 5/h | 51.6% (56,656), 15/h | 51.6% (83,447), 18/h | 51.1% (139,887), 40/h | 50.9% (211,787), 60/h |
| Logistic regression (18 features) | 51.1% (69,486), 14/h | 51.2% (74,289), 15/h | 51.3% (92,449), 19/h | 51.2% (130,498), 33/h | 50.9% (194,198), 54/h |
| Gradient boosting (18 features) | 52.0% (52,240), 8/h | 52.0% (56,312), 9/h | 51.6% (88,870), 19/h | 51.3% (130,275), 31/h | 50.8% (196,153), 54/h |
| Nearest neighbours (last 8 candles) | 50.6% (93,238), 27/h | 50.6% (97,129), 27/h | 50.6% (115,209), 32/h | 50.7% (137,589), 38/h | 50.4% (198,489), 56/h |

Assets whose own check (lower end of the 95% range) beats break-even, all rule families together:

- coverage any: 2 of 18: EURGBP 57.9% of 1620 (breakout 1/0/0/rev); USDCAD 57.4% of 1088 (breakout 1/0/0/rev)
- coverage 10%+: 1 of 18: USDCAD 57.4% of 1088 (breakout 1/0/0/rev)
- coverage 25%+: none of 18
- coverage 50%+: none of 18
- coverage 90%+: none of 18

## Crypto (3 assets)

| Family | Any coverage | At least 10% | 25% | 50% | 90% |
|---|---|---|---|---|---|
| Breakout (extension today: 2-30 candles, zone 0-30%) | 54.5% (9,915), 14/h | 54.5% (9,915), 14/h | 51.5% (27,843), 30/h | 51.5% (33,561), 40/h | - |
| Breakout, wider (1-30 candles, zone 0-50%) | 54.5% (10,753), 14/h | 54.5% (10,753), 14/h | 51.6% (27,550), 29/h | 52.6% (29,543), 35/h | 52.0% (49,381), 60/h |
| Candle colour (follow / fade) | 51.9% (23,278), 28/h | 51.9% (23,278), 28/h | 51.9% (23,278), 28/h | 51.5% (30,027), 35/h | 51.0% (49,710), 59/h |
| Streak of k candles (follow / fade) | 50.5% (24,656), 30/h | 50.5% (24,656), 30/h | 50.5% (24,656), 30/h | 52.0% (8,980), 31/h | - |
| Z-score vs moving average (revert / follow) | 52.0% (30,614), 32/h | 52.0% (30,614), 32/h | 52.0% (30,614), 32/h | 52.0% (30,614), 32/h | 51.6% (51,027), 60/h |
| RSI(2) (Connors) | 51.1% (42,759), 60/h | 51.1% (42,759), 60/h | 51.1% (42,759), 60/h | 51.0% (45,709), 60/h | 50.8% (51,034), 60/h |
| Time of day / minute of hour | 50.2% (49,332), 58/h | 50.2% (49,332), 58/h | 50.2% (49,332), 58/h | 50.2% (49,332), 58/h | 50.2% (49,332), 58/h |
| All rule families together (wider breakout + the rest) | 52.5% (22,710), 15/h | 52.5% (22,710), 15/h | 51.9% (31,532), 29/h | 52.4% (34,799), 35/h | 51.9% (48,839), 58/h |
| Logistic regression (18 features) | 52.3% (25,297), 23/h | 52.3% (25,297), 23/h | 52.3% (25,297), 23/h | 52.3% (35,106), 36/h | 52.0% (47,592), 54/h |
| Gradient boosting (18 features) | 53.8% (12,708), 14/h | 53.8% (12,708), 14/h | 51.8% (25,582), 24/h | 51.8% (38,697), 54/h | 51.8% (45,834), 54/h |
| Nearest neighbours (last 8 candles) | 50.5% (22,575), 25/h | 50.5% (22,575), 25/h | 50.4% (24,915), 25/h | 50.0% (39,200), 49/h | 50.0% (47,908), 56/h |

Assets whose own check (lower end of the 95% range) beats break-even, all rule families together:

- coverage any: 1 of 3: BTCUSD 58.9% of 4360 (breakout 2/0/60)
- coverage 10%+: 1 of 3: BTCUSD 58.9% of 4360 (breakout 2/0/60)
- coverage 25%+: none of 3
- coverage 50%+: 1 of 3: BTCUSD 55.7% of 10224 (breakout 1/10/0)
- coverage 90%+: none of 3

## Other (41 assets)

| Family | Any coverage | At least 10% | 25% | 50% | 90% |
|---|---|---|---|---|---|
| Breakout (extension today: 2-30 candles, zone 0-30%) | 50.9% (114,666), 22/h | 50.8% (139,286), 27/h | 50.8% (152,536), 28/h | 50.7% (200,151), 39/h | - |
| Breakout, wider (1-30 candles, zone 0-50%) | 50.7% (143,185), 24/h | 50.7% (158,619), 26/h | 50.8% (188,795), 37/h | 50.7% (229,899), 39/h | 50.7% (324,375), 60/h |
| Candle colour (follow / fade) | 50.2% (201,068), 36/h | 50.2% (201,068), 36/h | 50.3% (222,638), 38/h | 50.3% (257,976), 49/h | 50.3% (311,523), 60/h |
| Streak of k candles (follow / fade) | 50.5% (106,649), 26/h | 50.5% (112,384), 26/h | 50.6% (159,347), 29/h | 51.4% (5,209), 30/h | - |
| Z-score vs moving average (revert / follow) | 50.4% (234,934), 47/h | 50.4% (237,997), 47/h | 50.5% (245,558), 47/h | 50.4% (267,558), 59/h | 50.4% (327,895), 60/h |
| RSI(2) (Connors) | 50.5% (225,756), 50/h | 50.5% (225,756), 50/h | 50.5% (221,835), 41/h | 50.5% (262,559), 50/h | 50.4% (328,033), 60/h |
| Time of day / minute of hour | 50.2% (247,803), 57/h | 50.2% (276,303), 58/h | 50.2% (276,303), 58/h | 50.2% (313,083), 58/h | 50.3% (321,859), 59/h |
| All rule families together (wider breakout + the rest) | 50.7% (136,146), 24/h | 50.6% (174,194), 27/h | 50.6% (164,567), 25/h | 50.7% (242,916), 40/h | 50.6% (326,488), 60/h |
| Logistic regression (18 features) | 50.7% (163,898), 20/h | 50.6% (181,568), 24/h | 50.7% (197,272), 36/h | 50.6% (262,905), 46/h | 50.5% (313,292), 60/h |
| Gradient boosting (18 features) | 50.6% (131,129), 18/h | 50.6% (148,204), 23/h | 50.5% (189,263), 27/h | 50.6% (246,462), 45/h | 50.4% (311,394), 57/h |
| Nearest neighbours (last 8 candles) | 50.2% (201,422), 48/h | 50.2% (209,880), 48/h | 50.2% (228,147), 48/h | 50.2% (253,397), 49/h | 50.2% (307,062), 56/h |

Assets whose own check (lower end of the 95% range) beats break-even, all rule families together:

- coverage any: none of 41
- coverage 10%+: none of 41
- coverage 25%+: none of 41
- coverage 50%+: none of 41
- coverage 90%+: none of 41

## Entry 5 s after the open (8 real markets with 5-second candles)

All rule families together; the same arrows, judged with the entry price at the open and 5 s later (the extension buys about 0.1 s after the open, between the two).

| Coverage | Entry at the open | Entry 5 s later |
|---|---|---|
| any | **56.1%** (7,320) | 53.5% (4,499) |
| 10%+ | 53.5% (17,806) | 51.8% (10,799) |
| 25%+ | 53.2% (29,534) | 51.5% (17,832) |
| 50%+ | 51.8% (56,616) | 50.6% (34,174) |
| 90%+ | 51.4% (91,091) | 50.2% (54,610) |

