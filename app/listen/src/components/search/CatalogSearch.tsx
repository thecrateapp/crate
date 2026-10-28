import { CrateImage } from "../artwork/CrateImage";
import {
  CatalogSearchView,
  type CatalogSearchProps,
} from "./CatalogSearchView";
/** Listen transport adapter. Stories use the same view with local artwork fixtures. */
export function CatalogSearch<T>(
  props: Omit<CatalogSearchProps<T>, "renderImage">,
) {
  return (
    <CatalogSearchView
      {...props}
      renderImage={(image) => (
        <CrateImage
          src={image.src}
          alt={image.alt}
          className={image.className}
          loading="lazy"
          onError={image.onError}
        />
      )}
    />
  );
}
