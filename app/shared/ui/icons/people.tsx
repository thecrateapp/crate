import {
  Calendar as SolarCalendar,
  CalendarAdd as SolarCalendarAdd,
  CalendarMark as SolarCalendarMark,
  ChatRound as SolarChatRound,
  Lock as SolarLock,
  Logout as SolarLogout,
  Plain as SolarPlain,
  Ticket as SolarTicket,
  User as SolarUser,
  UserCheck as SolarUserCheck,
  UserCheckRounded as SolarUserCheckRounded,
  UserMinus as SolarUserMinus,
  UserPlus as SolarUserPlus,
  UserPlusRounded as SolarUserPlusRounded,
  UserRounded as SolarUserRounded,
  UsersGroupRounded as SolarUsersGroupRounded,
} from "@solar-icons/react-perf/Outline";

import { createIcon } from "./base";

export const Calendar = createIcon(SolarCalendar, "Calendar");
export const CalendarCheck = createIcon(SolarCalendarMark, "CalendarCheck");
export const CalendarDays = createIcon(SolarCalendar, "CalendarDays");
export const CalendarPlus = createIcon(SolarCalendarAdd, "CalendarPlus");
export const Lock = createIcon(SolarLock, "Lock");
export const LogOut = createIcon(SolarLogout, "LogOut");
export const MessageCircle = createIcon(SolarChatRound, "MessageCircle");
export const Send = createIcon(SolarPlain, "Send");
export const Ticket = createIcon(SolarTicket, "Ticket");
export const User = createIcon(SolarUser, "User");
export const UserCheck = createIcon(SolarUserCheck, "UserCheck");
export const UserMinus = createIcon(SolarUserMinus, "UserMinus");
export const UserPlus = createIcon(SolarUserPlus, "UserPlus");
export const UserRound = createIcon(SolarUserRounded, "UserRound");
export const UserRoundCheck = createIcon(
  SolarUserCheckRounded,
  "UserRoundCheck",
);
export const UserRoundPlus = createIcon(SolarUserPlusRounded, "UserRoundPlus");
export const Users = createIcon(SolarUsersGroupRounded, "Users");
