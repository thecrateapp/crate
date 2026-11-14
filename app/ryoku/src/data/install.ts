// Single home for every install instruction the site shows. The channel is a pacman
// repository published as GitHub release assets of thecrateapp/ryoku.

export const REPO_NAME = "crate-for-ryoku";
export const REPO_URL =
  "https://github.com/thecrateapp/ryoku/releases/download/repo";

export const PACMAN_CONF = [
  `[${REPO_NAME}]`,
  "SigLevel = Optional TrustAll",
  `Server = ${REPO_URL}`,
].join("\n");

export const INSTALL_PACKAGES =
  "sudo pacman -Syu crate-for-ryoku crate-desktop-bin";
export const SETUP = "crate-for-ryoku install";

export const TARBALL_URL =
  "https://github.com/thecrateapp/crate-for-ryoku/releases/latest";
export const TARBALL_COMMAND = "./install.sh";

export const MIN_RYOKU = "1.0.7";
