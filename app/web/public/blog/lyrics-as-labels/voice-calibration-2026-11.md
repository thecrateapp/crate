# Smart Mix 3 voice calibration, November 2026

This note preserves aggregate results used in _Lyrics as labels_. It contains no audio,
lyrics, track identifiers or library paths. The experiments ran in November 2026; the
article was reviewed on 8 November 2026. These are existing measurements, not a rerun.

## Reference labels

A nonempty lyric line contributes a voiced interval from its timestamp to the next line,
capped at six seconds. Empty and instrumental-marker lines add no interval. A phrase is
labelled voiced when intervals cover at least 25% of its duration, unvoiced at zero
coverage, and excluded in between. Instrumental records in the first comparison supply
unvoiced labels. Tracks with a lyric/audio duration difference greater than two seconds
are excluded.

These labels are a proxy. Line timing, omitted backing vocals and spoken samples can
produce errors in either direction. Agreement with these labels is neither a direct
measurement of audible vocal clashes nor a guaranteed lower bound on detector quality.

## Initial comparison, 4 November 2026

The spectral heuristic had labelled 13 of 322 phrases in 28 development tracks as voiced,
while missing entire tracks with obvious singing, and remained disabled.

The model comparison ran over 64 tracks, 254 minutes of audio and 649 phrases. The lyric
reference covered 449 phrases in 49 tracks: 343 voiced and 106 unvoiced. Lyrics were
synchronized for 46 tracks; three were marked instrumental by the provider. The remaining
tracks did not supply usable synchronized labels.

| Model                                        | ROC AUC | Mean model CPU per track | p95 model CPU per track | Model CPU per audio minute |
| -------------------------------------------- | ------: | -----------------------: | ----------------------: | -------------------------: |
| YAMNet (AudioSet)                            |   0.860 |                    3.5 s |                   5.4 s |                      0.9 s |
| PANNs CNN14 (AudioSet)                       |   0.872 |                  110.5 s |                 177.0 s |                     27.8 s |
| Essentia voice/instrumental (Discogs-EffNet) |   0.735 |                   12.5 s |                  17.2 s |                      3.2 s |

CPU is process CPU summed over all threads, not wall-clock time. Model times exclude
decoding. Decoding at the required sample rates averaged 0.7 CPU seconds per track.
This comparison used Essentia's YAMNet graph; the shipped worker uses Google's original
weights through Crate's PyTorch port. The report did not identify hardware sufficiently
to turn these costs into a general speed claim.

At the selected comparison thresholds, precision/recall/specificity were respectively
0.90/0.92/0.67 for YAMNet, 0.89/0.93/0.61 for PANNs and 0.82/0.99/0.29 for Essentia.
These thresholded metrics used five folds grouped by track. The AUC comparison itself
ranks the available phrase scores without choosing a threshold.

| Maximum line interval | Required phrase coverage | YAMNet AUC | PANNs AUC | Essentia AUC |
| --------------------- | -----------------------: | ---------: | --------: | -----------: |
| 4 s                   |                      25% |      0.861 |     0.880 |        0.739 |
| 6 s                   |                      25% |      0.860 |     0.872 |        0.735 |
| 8 s                   |                      25% |      0.857 |     0.870 |        0.726 |
| 6 s                   |                      50% |      0.869 |     0.887 |        0.749 |
| 6 s                   |                      10% |      0.854 |     0.865 |        0.725 |

The ordering remained PANNs, YAMNet, Essentia across these variants. It does not establish
that this ordering holds for other catalogues or reference labels.

## Broader calibration, 5 November 2026

The sample began with 358 production tracks from 20 genres, at most one per album, with
synced lyrics. The analyser generated no phrases for 66 of those tracks. Duration checks
excluded 23 tracks, and 328 phrases had ambiguous coverage. These exclusions can overlap;
they must not be subtracted as disjoint groups. The final labelled set comprised 275 tracks
and 2,721 phrases: 2,080 voiced and 641 unvoiced.

The comparison considered the share of windows above several window cuts, arithmetic mean
scores and the geometric mean on a byte log scale. The latter had ROC AUC 0.794.

Five-fold validation grouped by track selected F1-optimal log-byte cuts from 55 to 63.
The cut fitted to all labels was 55. The final chosen cut was 90, to retain more unvoiced
passages. The following sweep uses **all calibration labels**, not a held-out test of 90:

| Phrase byte cut | Precision | Recall | Specificity |
| --------------: | --------: | -----: | ----------: |
|              55 |      0.82 |   0.96 |        0.30 |
|              80 |      0.86 |   0.86 |        0.56 |
|              90 |      0.88 |   0.78 |        0.66 |

The fold-validated F1-optimal result (varying cuts) was precision 0.82, recall 0.94 and
specificity 0.32. Those numbers are not the same calculation as the all-label cut-55 row.

Per-genre log-score AUC included new wave 0.94, post-punk 0.92, industrial metal 0.64,
trip-hop 0.65 and black metal 0.66. Pop's AUC of 1.00 came from 62 phrases with 58 voiced
and only four unvoiced labels, so it provides weak evidence about performance on pop
instrumentals. These groups belong to the same calibration set, not an independent test.

## Window-byte storage check

The original calibration used float window scores. Storing each window as one byte on the
same log scale and then averaging the bytes moves some phrase values by one. On the 2,721
phrases, the differences were -1 for 60 phrases, 0 for 2,607 and +1 for 54.

At cut 90:

| Aggregation            | Precision | Recall | Specificity |
| ---------------------- | --------: | -----: | ----------: |
| Original float windows |    0.8825 | 0.7837 |      0.6615 |
| Rounded window bytes   |    0.8824 | 0.7832 |      0.6615 |

One phrase changed classification. AUC was 0.7940 for float aggregation and 0.7941 for
window bytes. Fresh inference and stored-window reuse use the same byte aggregation in
the implementation.

## Implementation references

- [Model comparison harness](https://github.com/thecrateapp/crate/tree/98d889ac20d48fbec10028d316a848fa729f2c7f/tools/smart-mix-eval/vocals).
- [Voice scoring and window-byte aggregation](https://github.com/thecrateapp/crate/blob/98d889ac20d48fbec10028d316a848fa729f2c7f/app/crate/smart_mix/vocals.py).
- [YAMNet port reference tests](https://github.com/thecrateapp/crate/blob/98d889ac20d48fbec10028d316a848fa729f2c7f/app/tests/test_smart_mix_voice_model.py).
- [Voice and stored-signal implementation notes](https://github.com/thecrateapp/crate/blob/98d889ac20d48fbec10028d316a848fa729f2c7f/docs/technical/smart-mix-operations.md#voice-per-phrase).

The comparison harness can score models and evaluate phrase labels. The lyric-derived
calibration scripts and raw reports were local experiment artifacts; this note preserves
their aggregate output. It is not a claim that the raw experiment data is published in
the repository.
