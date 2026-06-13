import {
  AddCircle as SolarAddCircle,
  AlignLeft as SolarAlignLeft,
  Archive as SolarArchive,
  ArchiveDown as SolarArchiveDown,
  ArrowDown as SolarArrowDown,
  ArrowLeft as SolarArrowLeft,
  ArrowRight as SolarArrowRight,
  ArrowUp as SolarArrowUp,
  Atom as SolarAtom,
  Bolt as SolarBolt,
  Box as SolarBox,
  Calendar as SolarCalendar,
  CalendarAdd as SolarCalendarAdd,
  CalendarMark as SolarCalendarMark,
  Camera as SolarCamera,
  ChatRound as SolarChatRound,
  CheckCircle as SolarCheckCircle,
  ClockCircle as SolarClockCircle,
  CloseSquare as SolarCloseSquare,
  Compass as SolarCompass,
  Copy as SolarCopy,
  Danger as SolarDanger,
  DangerTriangle as SolarDangerTriangle,
  Diskette as SolarDiskette,
  Dislike as SolarDislike,
  Download as SolarDownload,
  Export as SolarExport,
  Flame as SolarFlame,
  GalleryAdd as SolarGalleryAdd,
  Global as SolarGlobal,
  Graph as SolarGraph,
  HamburgerMenu as SolarHamburgerMenu,
  HeadphonesRoundSound as SolarHeadphonesRoundSound,
  Heart as SolarHeart,
  Home as SolarHome,
  InfoCircle as SolarInfoCircle,
  Like as SolarLike,
  Link as SolarLink,
  Lock as SolarLock,
  Logout as SolarLogout,
  MagicStick as SolarMagicStick,
  Magnifer as SolarMagnifer,
  Cassette2 as SolarCassette2,
  MapPoint as SolarMapPoint,
  Maximize as SolarMaximize,
  MenuDots as SolarMenuDots,
  Microphone as SolarMicrophone,
  Microphone2 as SolarMicrophone2,
  Microphone3 as SolarMicrophone3,
  Moon as SolarMoon,
  MusicLibrary as SolarMusicLibrary,
  MusicLibrary2 as SolarMusicLibrary2,
  MusicNote2 as SolarMusicNote2,
  MusicNotes as SolarMusicNotes,
  Pen as SolarPen,
  Pin as SolarPin,
  Plain as SolarPlain,
  Playlist2 as SolarPlaylist2,
  Power as SolarPower,
  Pulse as SolarPulse,
  QrCode as SolarQrCode,
  Radar2 as SolarRadar2,
  RecordCircle as SolarRecordCircle,
  Refresh as SolarRefresh,
  Repeat as SolarRepeat,
  RepeatOne as SolarRepeatOne,
  Reorder2 as SolarReorder2,
  Route as SolarRoute,
  RoundAltArrowDown as SolarRoundAltArrowDown,
  RoundAltArrowLeft as SolarRoundAltArrowLeft,
  RoundAltArrowRight as SolarRoundAltArrowRight,
  RoundAltArrowUp as SolarRoundAltArrowUp,
  Screencast as SolarScreencast,
  Server as SolarServer,
  Settings as SolarSettings,
  Share as SolarShare,
  ShieldCheck as SolarShieldCheck,
  Shuffle as SolarShuffle,
  SkipNext as SolarSkipNext,
  SkipPrevious as SolarSkipPrevious,
  Smartphone as SolarSmartphone,
  Soundwave as SolarSoundwave,
  Star as SolarStar,
  Stars as SolarStars,
  Station as SolarStation,
  Stop as SolarStop,
  StreetsNavigation as SolarStreetsNavigation,
  Sun as SolarSun,
  Tag as SolarTag,
  Ticket as SolarTicket,
  TrashBinTrash as SolarTrashBinTrash,
  Tuning as SolarTuning,
  UndoLeft as SolarUndoLeft,
  Upload as SolarUpload,
  User as SolarUser,
  UserCheck as SolarUserCheck,
  UserCheckRounded as SolarUserCheckRounded,
  UserMinus as SolarUserMinus,
  UserPlus as SolarUserPlus,
  UserPlusRounded as SolarUserPlusRounded,
  UserRounded as SolarUserRounded,
  UsersGroupRounded as SolarUsersGroupRounded,
  VinylRecord as SolarVinylRecord,
  VolumeCross as SolarVolumeCross,
  VolumeLoud as SolarVolumeLoud,
} from "@solar-icons/react-perf/Outline";
import {
  ArchiveDown as SolarArchiveDownBold,
  Heart as SolarHeartBold,
  Pause as SolarPauseBold,
  Play as SolarPlayBold,
} from "@solar-icons/react-perf/Bold";
import type { IconProps as SolarIconProps } from "@solar-icons/react-perf";
import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";

export interface CrateIconProps
  extends Omit<SVGProps<SVGSVGElement>, "ref" | "width" | "height"> {
  size?: number | string;
  width?: number | string;
  height?: number | string;
  absoluteStrokeWidth?: boolean;
}

export type CrateIcon = ForwardRefExoticComponent<
  CrateIconProps & RefAttributes<SVGSVGElement>
>;

export type LucideIcon = CrateIcon;

export const CRATE_ICON_SIZE = {
  micro: 12,
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  nav: 21,
  navMobile: 22,
  xl: 24,
} as const;

export type CrateIconSize = keyof typeof CRATE_ICON_SIZE;

type SolarIcon = ForwardRefExoticComponent<
  Omit<SolarIconProps, "ref"> & RefAttributes<SVGSVGElement>
>;

function createIcon(Icon: SolarIcon, displayName: string): CrateIcon {
  const WrappedIcon = forwardRef<SVGSVGElement, CrateIconProps>(
    (
      {
        size = CRATE_ICON_SIZE.md,
        width,
        height,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        ...props
      },
      ref,
    ) => {
      const dimensions: Pick<SVGProps<SVGSVGElement>, "width" | "height"> = {};

      if (width !== undefined) {
        dimensions.width = width;
      }

      if (height !== undefined) {
        dimensions.height = height;
      }

      return <Icon ref={ref} size={size} {...dimensions} {...props} />;
    },
  );

  WrappedIcon.displayName = displayName;

  return WrappedIcon;
}

export const Activity = createIcon(SolarPulse, "Activity");
export const Airplay = createIcon(SolarScreencast, "Airplay");
export const AlignLeft = createIcon(SolarAlignLeft, "AlignLeft");
export const Archive = createIcon(SolarArchive, "Archive");
export const ArrowDown = createIcon(SolarArrowDown, "ArrowDown");
export const ArrowLeft = createIcon(SolarArrowLeft, "ArrowLeft");
export const ArrowRight = createIcon(SolarArrowRight, "ArrowRight");
export const ArrowUp = createIcon(SolarArrowUp, "ArrowUp");
export const Brain = createIcon(SolarAtom, "Brain");
export const Calendar = createIcon(SolarCalendar, "Calendar");
export const CalendarCheck = createIcon(SolarCalendarMark, "CalendarCheck");
export const CalendarPlus = createIcon(SolarCalendarAdd, "CalendarPlus");
export const Camera = createIcon(SolarCamera, "Camera");
export const Check = createIcon(SolarCheckCircle, "Check");
export const Clock = createIcon(SolarClockCircle, "Clock");
export const CompactDisc = createIcon(SolarVinylRecord, "CompactDisc");
export const Compass = createIcon(SolarCompass, "Compass");
export const Copy = createIcon(SolarCopy, "Copy");
export const Download = createIcon(SolarDownload, "Download");
export const Globe = createIcon(SolarGlobal, "Globe");
export const Heart = createIcon(SolarHeart, "Heart");
export const HeartBold = createIcon(SolarHeartBold, "HeartBold");
export const Home = createIcon(SolarHome, "Home");
export const Link = createIcon(SolarLink, "Link");
export const Lock = createIcon(SolarLock, "Lock");
export const LogOut = createIcon(SolarLogout, "LogOut");
export const MapPin = createIcon(SolarMapPoint, "MapPin");
export const Pause = createIcon(SolarPauseBold, "Pause");
export const Pin = createIcon(SolarPin, "Pin");
export const Play = createIcon(SolarPlayBold, "Play");
export const Plus = createIcon(SolarAddCircle, "Plus");
export const QrCode = createIcon(SolarQrCode, "QrCode");
export const Repeat = createIcon(SolarRepeat, "Repeat");
export const Search = createIcon(SolarMagnifer, "Search");
export const Server = createIcon(SolarServer, "Server");
export const Settings = createIcon(SolarSettings, "Settings");
export const Shuffle = createIcon(SolarShuffle, "Shuffle");
export const Square = createIcon(SolarStop, "Square");
export const Star = createIcon(SolarStar, "Star");
export const ThumbsDown = createIcon(SolarDislike, "ThumbsDown");
export const ThumbsUp = createIcon(SolarLike, "ThumbsUp");
export const Upload = createIcon(SolarUpload, "Upload");
export const User = createIcon(SolarUser, "User");
export const UserPlus = createIcon(SolarUserPlus, "UserPlus");

export const AlertCircle = createIcon(SolarDanger, "AlertCircle");
export const AlertTriangle = createIcon(SolarDangerTriangle, "AlertTriangle");
export const ArrowDownToLine = createIcon(SolarArchiveDown, "ArrowDownToLine");
export const ArrowDownToLineBold = createIcon(
  SolarArchiveDownBold,
  "ArrowDownToLineBold",
);
export const AudioLines = createIcon(SolarSoundwave, "AudioLines");
export const BarChart3 = createIcon(SolarPulse, "BarChart3");
export const CalendarDays = createIcon(SolarCalendar, "CalendarDays");
export const Cast = createIcon(SolarScreencast, "Cast");
export const CheckCircle2 = createIcon(SolarCheckCircle, "CheckCircle2");
export const CheckIcon = createIcon(SolarCheckCircle, "CheckIcon");
export const ChevronDown = createIcon(SolarRoundAltArrowDown, "ChevronDown");
export const ChevronDownIcon = createIcon(
  SolarRoundAltArrowDown,
  "ChevronDownIcon",
);
export const ChevronLeft = createIcon(SolarRoundAltArrowLeft, "ChevronLeft");
export const ChevronRight = createIcon(SolarRoundAltArrowRight, "ChevronRight");
export const ChevronRightIcon = createIcon(
  SolarRoundAltArrowRight,
  "ChevronRightIcon",
);
export const ChevronUp = createIcon(SolarRoundAltArrowUp, "ChevronUp");
export const ChevronUpIcon = createIcon(SolarRoundAltArrowUp, "ChevronUpIcon");
export const CircleIcon = createIcon(SolarRecordCircle, "CircleIcon");
export const Clock3 = createIcon(SolarClockCircle, "Clock3");
export const Disc = createIcon(SolarVinylRecord, "Disc");
export const Disc3 = createIcon(SolarVinylRecord, "Disc3");
export const ExternalLink = createIcon(SolarExport, "ExternalLink");
export const Flame = createIcon(SolarFlame, "Flame");
export const Gauge = createIcon(SolarGraph, "Gauge");
export const Globe2 = createIcon(SolarGlobal, "Globe2");
export const GripVertical = createIcon(SolarReorder2, "GripVertical");
export const HamburgerMenu = createIcon(SolarHamburgerMenu, "HamburgerMenu");
export const HardDrive = createIcon(SolarServer, "HardDrive");
export const ImagePlus = createIcon(SolarGalleryAdd, "ImagePlus");
export const Info = createIcon(SolarInfoCircle, "Info");
export const Library = createIcon(SolarMusicLibrary, "Library");
export const ListMusic = createIcon(SolarMusicLibrary2, "ListMusic");
export const ListPlus = createIcon(SolarPlaylist2, "ListPlus");
export const Loader2 = createIcon(SolarRefresh, "Loader2");
export const Maximize2 = createIcon(SolarMaximize, "Maximize2");
export const MessageCircle = createIcon(SolarChatRound, "MessageCircle");
export const Mic2 = createIcon(SolarMicrophone2, "Mic2");
export const Mic3 = createIcon(SolarMicrophone3, "Mic3");
export const MonitorSpeaker = createIcon(
  SolarHeadphonesRoundSound,
  "MonitorSpeaker",
);
export const Moon = createIcon(SolarMoon, "Moon");
export const MoreHorizontal = createIcon(SolarMenuDots, "MoreHorizontal");
export const Collection = createIcon(SolarCassette2, "Collection");
export const Music = createIcon(SolarSoundwave, "Music");
export const Music2 = createIcon(SolarMusicNotes, "Music2");
export const Music4 = createIcon(SolarMusicNote2, "Music4");
export const Navigation = createIcon(SolarStreetsNavigation, "Navigation");
export const PackagePlus = createIcon(SolarBox, "PackagePlus");
export const PanelLeftClose = createIcon(
  SolarRoundAltArrowLeft,
  "PanelLeftClose",
);
export const PanelLeftOpen = createIcon(
  SolarRoundAltArrowRight,
  "PanelLeftOpen",
);
export const Pencil = createIcon(SolarPen, "Pencil");
export const Power = createIcon(SolarPower, "Power");
export const Radar = createIcon(SolarRadar2, "Radar");
export const Radio = createIcon(SolarMicrophone, "Radio");
export const RadioTower = createIcon(SolarStation, "RadioTower");
export const RefreshCw = createIcon(SolarRefresh, "RefreshCw");
export const Repeat1 = createIcon(SolarRepeatOne, "Repeat1");
export const Repeat2 = createIcon(SolarRepeat, "Repeat2");
export const RotateCcw = createIcon(SolarUndoLeft, "RotateCcw");
export const Route = createIcon(SolarRoute, "Route");
export const Rss = createIcon(SolarRadar2, "Rss");
export const Save = createIcon(SolarDiskette, "Save");
export const Send = createIcon(SolarPlain, "Send");
export const Share2 = createIcon(SolarShare, "Share2");
export const Shield = createIcon(SolarShieldCheck, "Shield");
export const SkipBack = createIcon(SolarSkipPrevious, "SkipBack");
export const SkipForward = createIcon(SolarSkipNext, "SkipForward");
export const SlidersHorizontal = createIcon(SolarTuning, "SlidersHorizontal");
export const Smartphone = createIcon(SolarSmartphone, "Smartphone");
export const Sparkles = createIcon(SolarStars, "Sparkles");
export const Sun = createIcon(SolarSun, "Sun");
export const Tag = createIcon(SolarTag, "Tag");
export const Ticket = createIcon(SolarTicket, "Ticket");
export const Trash2 = createIcon(SolarTrashBinTrash, "Trash2");
export const UserCheck = createIcon(SolarUserCheck, "UserCheck");
export const UserMinus = createIcon(SolarUserMinus, "UserMinus");
export const UserRound = createIcon(SolarUserRounded, "UserRound");
export const UserRoundCheck = createIcon(
  SolarUserCheckRounded,
  "UserRoundCheck",
);
export const UserRoundPlus = createIcon(SolarUserPlusRounded, "UserRoundPlus");
export const Users = createIcon(SolarUsersGroupRounded, "Users");
export const Volume2 = createIcon(SolarVolumeLoud, "Volume2");
export const VolumeX = createIcon(SolarVolumeCross, "VolumeX");
export const WandSparkles = createIcon(SolarMagicStick, "WandSparkles");
export const X = createIcon(SolarCloseSquare, "X");
export const XIcon = createIcon(SolarCloseSquare, "XIcon");
export const Zap = createIcon(SolarBolt, "Zap");
