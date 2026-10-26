import { CalendarIcon as SolarCalendar } from "@solar-icons/react/outline/calendar";
import { CalendarAddIcon as SolarCalendarAdd } from "@solar-icons/react/outline/calendar-add";
import { CalendarMarkIcon as SolarCalendarMark } from "@solar-icons/react/outline/calendar-mark";
import { ChatRoundIcon as SolarChatRound } from "@solar-icons/react/outline/chat-round";
import { LockIcon as SolarLock } from "@solar-icons/react/outline/lock";
import { LogoutIcon as SolarLogout } from "@solar-icons/react/outline/logout";
import { PlaneIcon as SolarPlain } from "@solar-icons/react/outline/plane";
import { TicketIcon as SolarTicket } from "@solar-icons/react/outline/ticket";
import { UserIcon as SolarUser } from "@solar-icons/react/outline/user";
import { UserCheckIcon as SolarUserCheck } from "@solar-icons/react/outline/user-check";
import { UserCheckRoundedIcon as SolarUserCheckRounded } from "@solar-icons/react/outline/user-check-rounded";
import { UserMinusIcon as SolarUserMinus } from "@solar-icons/react/outline/user-minus";
import { UserPlusIcon as SolarUserPlus } from "@solar-icons/react/outline/user-plus";
import { UserPlusRoundedIcon as SolarUserPlusRounded } from "@solar-icons/react/outline/user-plus-rounded";
import { UserRoundedIcon as SolarUserRounded } from "@solar-icons/react/outline/user-rounded";
import { UsersGroupRoundedIcon as SolarUsersGroupRounded } from "@solar-icons/react/outline/users-group-rounded";

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
