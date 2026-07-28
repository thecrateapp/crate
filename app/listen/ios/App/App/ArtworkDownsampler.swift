import CoreGraphics
import Foundation
import ImageIO

enum CrateArtworkDownsampler {
    static func decode(data: Data, maxPixelSize: Int = 1024) -> CGImage? {
        guard
            maxPixelSize > 0,
            let source = CGImageSourceCreateWithData(data as CFData, [
                kCGImageSourceShouldCache: false
            ] as CFDictionary)
        else {
            return nil
        }

        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ] as CFDictionary)
    }
}
