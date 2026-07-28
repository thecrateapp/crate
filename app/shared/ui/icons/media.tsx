import {
  Cassette2 as SolarCassette2,
  Dislike as SolarDislike,
  HeadphonesRoundSound as SolarHeadphonesRoundSound,
  Heart as SolarHeart,
  Like as SolarLike,
  Microphone as SolarMicrophone,
  Microphone2 as SolarMicrophone2,
  Microphone3 as SolarMicrophone3,
  MusicLibrary as SolarMusicLibrary,
  MusicLibrary2 as SolarMusicLibrary2,
  MusicNote2 as SolarMusicNote2,
  MusicNotes as SolarMusicNotes,
  Playlist2 as SolarPlaylist2,
  Radar2 as SolarRadar2,
  Repeat as SolarRepeat,
  RepeatOne as SolarRepeatOne,
  Screencast as SolarScreencast,
  Shuffle as SolarShuffle,
  SkipNext as SolarSkipNext,
  SkipPrevious as SolarSkipPrevious,
  Soundwave as SolarSoundwave,
  Station as SolarStation,
  Stop as SolarStop,
  VinylRecord as SolarVinylRecord,
  VolumeCross as SolarVolumeCross,
  VolumeLoud as SolarVolumeLoud,
} from "@solar-icons/react-perf/Outline";
import {
  Heart as SolarHeartBold,
  Pause as SolarPauseBold,
  Play as SolarPlayBold,
} from "@solar-icons/react-perf/Bold";

import { createIcon } from "./base";

export const Airplay = createIcon(SolarScreencast, "Airplay");
export const AudioLines = createIcon(SolarSoundwave, "AudioLines");
export const Cast = createIcon(SolarScreencast, "Cast");
export const Collection = createIcon(SolarCassette2, "Collection");
export const CompactDisc = createIcon(SolarVinylRecord, "CompactDisc");
export const Disc = createIcon(SolarVinylRecord, "Disc");
export const Disc3 = createIcon(SolarVinylRecord, "Disc3");
export const Heart = createIcon(SolarHeart, "Heart");
export const HeartBold = createIcon(SolarHeartBold, "HeartBold");
export const Library = createIcon(SolarMusicLibrary, "Library");
export const ListMusic = createIcon(SolarMusicLibrary2, "ListMusic");
export const ListPlus = createIcon(SolarPlaylist2, "ListPlus");
export const Mic2 = createIcon(SolarMicrophone2, "Mic2");
export const Mic3 = createIcon(SolarMicrophone3, "Mic3");
export const MonitorSpeaker = createIcon(
  SolarHeadphonesRoundSound,
  "MonitorSpeaker",
);
export const Music = createIcon(SolarSoundwave, "Music");
export const Music2 = createIcon(SolarMusicNotes, "Music2");
export const Music4 = createIcon(SolarMusicNote2, "Music4");
export const Pause = createIcon(SolarPauseBold, "Pause");
export const Play = createIcon(SolarPlayBold, "Play");
export const Radar = createIcon(SolarRadar2, "Radar");
export const Radio = createIcon(SolarMicrophone, "Radio");
export const RadioTower = createIcon(SolarStation, "RadioTower");
export const Repeat = createIcon(SolarRepeat, "Repeat");
export const Repeat1 = createIcon(SolarRepeatOne, "Repeat1");
export const Repeat2 = createIcon(SolarRepeat, "Repeat2");
export const Rss = createIcon(SolarRadar2, "Rss");
export const Shuffle = createIcon(SolarShuffle, "Shuffle");
export const SkipBack = createIcon(SolarSkipPrevious, "SkipBack");
export const SkipForward = createIcon(SolarSkipNext, "SkipForward");
export const Square = createIcon(SolarStop, "Square");
export const ThumbsDown = createIcon(SolarDislike, "ThumbsDown");
export const ThumbsUp = createIcon(SolarLike, "ThumbsUp");
export const Volume2 = createIcon(SolarVolumeLoud, "Volume2");
export const VolumeX = createIcon(SolarVolumeCross, "VolumeX");
