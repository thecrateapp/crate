"""A second opinion on bars of three, from madmom's own downbeat model.

Beat This!'s DBN hears fast 4/4 punk and metal (d-beat, thrash, death) in three, and
since SM3-D16 a track in three gets no downbeat and no phrases. madmom's recurrent
downbeat network, decoded by the same kind of DBN, is an independent model: on the
evaluation sets it heard four on eight of the nine such tracks it read and three on
the two most likely to be in three. ``beat_model`` asks it only when Beat This!'s DBN
prefers three, about 2.5 % of tracks, and keeps bars of three only if it agrees.

madmom's networks are CC BY-NC-SA 4.0; Crate is free and open source, and Diego
approved running them in production (gate MG1, 2026-11-09). They ship with the madmom
package the analysis image installs; nothing is downloaded at run time.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

ARBITER_NAME = "madmom-dbn"
# madmom's downbeat network reads 44.1 kHz audio at 100 frames per second.
ARBITER_SAMPLE_RATE = 44_100
ARBITER_FPS = 100
ARBITER_BEATS_PER_BAR = (3, 4)
# Frames of features per chunk: 30 s at 100 fps. The largest chunk STFT (4,096
# points) is then about 50 MB, against about 1 GB for a whole 600 s track.
FEATURE_CHUNK_FRAMES = 3_000


class MadmomMeterArbiter:
    """The bar length (3 or 4) madmom's downbeat network and DBN prefer for a file.

    The same verdict as madmom's ``RNNDownBeatProcessor`` and
    ``DBNDownBeatTrackingProcessor`` on the whole file, in bounded memory for the
    analysis worker, which runs several profiles at once. madmom's own pipeline
    peaked at 5.2 GB on a 555 s track: it keeps each frame size's STFT of the whole
    file until the features are stacked, and its Viterbi keeps a back-pointer per
    frame and state. Here the spectrograms are computed ``FEATURE_CHUNK_FRAMES`` at a
    time with madmom's own processors, and the DBN keeps only scores
    (``meter_from_activations``), so the arbiter stays under what Beat This! takes in
    the same process.
    """

    def __init__(self) -> None:
        from madmom.features.downbeats import (
            DBNDownBeatTrackingProcessor,
            RNNDownBeatProcessor,
        )

        # One thread: the analysis worker already runs one profile per process.
        self._network = RNNDownBeatProcessor(num_threads=1)
        self._dbn = DBNDownBeatTrackingProcessor(
            beats_per_bar=list(ARBITER_BEATS_PER_BAR), fps=ARBITER_FPS
        )

    def __call__(self, path: str | Path) -> int | None:
        return meter_from_activations(self._dbn, self.activations(Path(path)))

    def activations(self, path: Path) -> np.ndarray:
        """madmom's downbeat activations of a file, as ``RNNDownBeatProcessor``
        gives them.

        The decoded audio (about 100 MB for 600 s at 44.1 kHz) is freed once the
        features exist, and the features once the network has read them, so
        neither adds to the process's peak while the network and the DBN run.
        """
        from crate.smart_mix.beat_model import _load_signal

        _, network, select = self._network.processors
        samples, rate = _load_signal(path, ARBITER_SAMPLE_RATE)
        features = self.features(samples, rate)
        del samples
        output = network(features)
        del features
        return select(output)

    def features(self, samples: np.ndarray, rate: int) -> np.ndarray:
        """The network's input, as ``RNNDownBeatProcessor``'s pre-processing gives
        it, with the spectrograms computed a chunk of frames at a time."""
        from madmom.audio.signal import Signal

        signal_processor, branches, stack = self._network.processors[0].processors
        signal = signal_processor(Signal(samples, sample_rate=rate, num_channels=1))
        return stack(
            [_branch_features(signal, branch) for branch in branches.processors]
        )


def _branch_features(signal: Any, branch: Any) -> np.ndarray:
    """One frame size's log-filtered spectrogram and its positive difference.

    ``branch`` is madmom's chain (frames, STFT, filterbank, log, difference). Each
    chunk frames the whole signal with its origin moved, so frame ``i`` of a chunk
    is frame ``start + i`` of the whole file, padding included; filterbank and log
    work frame by frame, and the difference runs once on the whole spectrogram.
    """
    from madmom.audio.spectrogram import Spectrogram, _diff_frames

    frames, stft, filterbank, logarithm, difference = branch.processors
    whole = frames(signal)
    hop = float(whole.hop_size)
    if not hop.is_integer():
        raise ValueError(f"madmom's hop of {hop} samples is not whole")
    chunks = []
    for start in range(0, whole.num_frames, FEATURE_CHUNK_FRAMES):
        chunk = frames(
            signal,
            origin=-start * int(hop),
            num_frames=min(FEATURE_CHUNK_FRAMES, whole.num_frames - start),
        )
        spectrogram = logarithm(filterbank(stft(chunk)))
        if difference.diff_frames is None:
            difference.diff_frames = _diff_frames(
                difference.diff_ratio,
                frame_size=spectrogram.stft.frames.frame_size,
                hop_size=spectrogram.stft.frames.hop_size,
                window=spectrogram.stft.window,
            )
        # A plain copy: the chunk's STFT and spectrogram are freed with it.
        chunks.append(np.array(spectrogram, copy=True))
    return difference(np.concatenate(chunks).view(Spectrogram))


def meter_from_activations(dbn: Any, activations: Any) -> int | None:
    """The bar length whose path the DBN scores higher, or None without beats.

    The same choice as ``DBNDownBeatTrackingProcessor`` (threshold, one Viterbi pass
    per bar length, the higher log probability, the first bar length on a tie), but
    only the log probabilities are needed, not the paths. madmom's Viterbi keeps a
    back-pointer per frame and state to trace the path: about 15,000 states for bars
    of four at 100 fps, so 3.3 GB for a 555 s track. ``viterbi_log_probability`` runs
    the same forward pass in O(states) memory.
    """
    from madmom.features.downbeats import threshold_activations

    if dbn.threshold:
        activations, _ = threshold_activations(activations, dbn.threshold)
    if not activations.any():
        return None
    best: tuple[float, int] | None = None
    for beats_per_bar, hmm in zip(dbn.beats_per_bar, dbn.hmms):
        log_probability = viterbi_log_probability(hmm, activations)
        if best is None or log_probability > best[0]:
            best = (log_probability, int(beats_per_bar))
    return None if best is None else best[1]


def viterbi_log_probability(hmm: Any, observations: np.ndarray) -> float:
    """The log probability of madmom's Viterbi path, without the path.

    madmom's ``HiddenMarkovModel.viterbi`` step by step: for each state, the best
    predecessor's score plus the transition's log probability, plus the state's
    observation log density; the result is the best final score. Only the previous
    frame's scores are kept.
    """
    transitions = hmm.transition_model
    starts = np.asarray(transitions.pointers[:-1], dtype=np.intp)
    if np.any(np.diff(transitions.pointers) <= 0):
        raise ValueError("every state needs a predecessor")
    predecessors = np.asarray(transitions.states, dtype=np.intp)
    transition_log = np.asarray(transitions.log_probabilities, dtype=np.float64)
    density_of_state = np.asarray(hmm.observation_model.pointers, dtype=np.intp)
    densities = hmm.observation_model.log_densities(observations)
    with np.errstate(divide="ignore"):
        scores = np.log(np.asarray(hmm.initial_distribution, dtype=np.float64))
    for frame_densities in densities:
        scores = np.maximum.reduceat(scores[predecessors] + transition_log, starts)
        scores += frame_densities[density_of_state]
    return float(scores.max())


@lru_cache(maxsize=1)
def load_meter_arbiter() -> MadmomMeterArbiter | None:
    """The process-wide arbiter, or None when madmom or its networks are missing."""
    try:
        return MadmomMeterArbiter()
    except Exception:
        log.warning(
            "madmom's downbeat network could not be loaded; tracks the DBN hears in "
            "three keep bars of three",
            exc_info=True,
        )
        return None


__all__ = [
    "ARBITER_BEATS_PER_BAR",
    "ARBITER_FPS",
    "ARBITER_NAME",
    "ARBITER_SAMPLE_RATE",
    "FEATURE_CHUNK_FRAMES",
    "MadmomMeterArbiter",
    "load_meter_arbiter",
    "meter_from_activations",
    "viterbi_log_probability",
]
