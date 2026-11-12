import { BoxIcon as SolarBox } from "@solar-icons/react/outline/box";
import { CloudStorageIcon as SolarCloudStorage } from "@solar-icons/react/outline/cloud-storage";
import { FolderCloudIcon as SolarFolderCloud } from "@solar-icons/react/outline/folder-cloud";
import { ListIcon as SolarList } from "@solar-icons/react/outline/list";
import { MoonIcon as SolarMoon } from "@solar-icons/react/outline/moon";
import { RankingIcon as SolarRanking } from "@solar-icons/react/outline/ranking";
import { ServerIcon as SolarServer } from "@solar-icons/react/outline/server";
import { ServerPathIcon as SolarServerPath } from "@solar-icons/react/outline/server-path";
import { SettingsIcon as SolarSettings } from "@solar-icons/react/outline/settings";
import { SmartphoneIcon as SolarSmartphone } from "@solar-icons/react/outline/smartphone";
import { SsdRoundIcon as SolarSsdRound } from "@solar-icons/react/outline/ssd-round";
import { SunIcon as SolarSun } from "@solar-icons/react/outline/sun";
import { WidgetIcon as SolarWidget } from "@solar-icons/react/outline/widget";

import { createIcon } from "./base";

// Backup destination kinds (Admin Backups, BG1-2): volume, object storage,
// SFTP server and a cloud drive folder.
export const CloudStorage = createIcon(SolarCloudStorage, "CloudStorage");
export const FolderCloud = createIcon(SolarFolderCloud, "FolderCloud");
export const HardDrive = createIcon(SolarServer, "HardDrive");
export const LayoutGrid = createIcon(SolarWidget, "LayoutGrid");
export const ListOrdered = createIcon(SolarList, "ListOrdered");
export const Moon = createIcon(SolarMoon, "Moon");
export const PackagePlus = createIcon(SolarBox, "PackagePlus");
export const Podium = createIcon(SolarRanking, "Podium");
export const Server = createIcon(SolarServer, "Server");
export const ServerPath = createIcon(SolarServerPath, "ServerPath");
export const Settings = createIcon(SolarSettings, "Settings");
export const Smartphone = createIcon(SolarSmartphone, "Smartphone");
export const SsdRound = createIcon(SolarSsdRound, "SsdRound");
export const Sun = createIcon(SolarSun, "Sun");
