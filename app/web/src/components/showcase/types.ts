/** One showcase slide: a wide shot for desktops and a 4:5 portrait for phones,
 * each at full size and a smaller size for srcset. */
export interface ShowcaseShot {
  title: string;
  caption: string;
  alt: string;
  src: string;
  srcSmall: string;
  width: number;
  height: number;
  portrait: string;
  portraitSmall: string;
  portraitWidth: number;
  portraitHeight: number;
}
