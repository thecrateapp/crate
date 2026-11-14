export interface Clip {
  id: string;
  title: string;
  caption: string;
  /** Still frame shown before playback and when the video cannot load. */
  poster: string;
  webm: string;
  mp4?: string;
}

const clip = (id: string, title: string, caption: string): Clip => ({
  id,
  title,
  caption,
  poster: `/media/${id}.jpg`,
  webm: `/media/${id}.webm`,
});

export const HERO: Clip = {
  ...clip("hero", "Crate for Ryoku", "A day on the Crate desktop."),
  mp4: "/media/hero.mp4",
};

export const CLIPS: Clip[] = [
  clip("qsbar", "QS Bar and crate-mark", "The Crate mark on the bar: now playing, transport and Crate's equalizer in one panel."),
  clip("controls", "Controls", "Super+Esc for power, session and quick toggles, in the same glass as everything else."),
  clip("launcher", "Launcher", "Apps, files and your Crate library in one field. Type cr to search Crate alone."),
  clip("gamebar", "Game Bar", "Ryoku's Game Bar in Crate's type and hairlines."),
  clip("kit", "Kit", "Ryoku's control kit in Crate's palette: the Beam, chips, sliders and toggles."),
  clip("pickers", "Pickers", "Wallpaper, rice and theme pickers drawn to the same rules."),
  clip("dock", "The shima dock", "A glass body with 6 px corners, a small lift on hover and a dot for every open window."),
  clip("notifications", "Notifications", "Hairline cards with Crate's type and cyan marks."),
];
