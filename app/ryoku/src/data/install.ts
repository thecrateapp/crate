// Single home for every install instruction the site shows. The channel is Crate's
// own signed pacman repository, published as release assets of
// thecrateapp/crate-for-ryoku (packaging/repo/publish.sh there).

export const REPO_NAME = "crate-for-ryoku";
export const REPO_URL =
  "https://github.com/thecrateapp/crate-for-ryoku/releases/download/repo";

// The repository signing key. The armored public key is served beside the site
// (public/crate-for-ryoku.gpg); install.test.ts checks it carries this fingerprint.
export const KEY_FINGERPRINT = "AD4DFA15F0A84853D4D711850EB2D64FEFAC7445";
export const KEY_PATH = "/crate-for-ryoku.gpg";
export const KEY_URL = `https://ryoku.cratemusic.app${KEY_PATH}`;

export const TRUST_KEY = [
  `curl -fsSLO ${KEY_URL}`,
  `gpg --show-keys ${REPO_NAME}.gpg`,
  `sudo pacman-key --add ${REPO_NAME}.gpg`,
  `sudo pacman-key --lsign-key ${KEY_FINGERPRINT}`,
].join("\n");

export const PACMAN_CONF = [
  `[${REPO_NAME}]`,
  "SigLevel = Required",
  `Server = ${REPO_URL}`,
].join("\n");

// The repository also ships Ryoku itself, built from Crate's fork with Crate's
// patches, so its block goes above [ryoku]: pacman takes a package from the first
// repository that lists it. The fork tags the source of every build it publishes.
export const RYOKU_REPO = "ryoku";
export const RYOKU_FORK_URL = "https://github.com/thecrateapp/ryoku";

export const INSTALL_PACKAGES =
  "sudo pacman -Syu crate-for-ryoku crate-desktop-bin";

// Back to stock Ryoku: with the block gone, -uu lets pacman move the Ryoku
// packages down to the versions [ryoku] serves.
export const STOCK_RYOKU = "sudo pacman -Syuu";
export const SETUP = "crate-for-ryoku install";

export const TARBALL_URL =
  "https://github.com/thecrateapp/crate-for-ryoku/releases/latest";
export const TARBALL_COMMAND = "./install.sh";

export const MIN_RYOKU = "1.0.7";
