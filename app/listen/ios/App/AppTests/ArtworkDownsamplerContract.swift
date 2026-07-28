import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
enum ArtworkDownsamplerContract {
    static func main() {
        let width = 2048
        let height = 1536
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard
            let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            fatalError("Unable to create artwork fixture")
        }
        context.setFillColor(CGColor(red: 0.1, green: 0.4, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        guard let sourceImage = context.makeImage() else {
            fatalError("Unable to render artwork fixture")
        }

        let encoded = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                encoded,
                UTType.jpeg.identifier as CFString,
                1,
                nil
            )
        else {
            fatalError("Unable to create artwork encoder")
        }
        CGImageDestinationAddImage(destination, sourceImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            fatalError("Unable to encode artwork fixture")
        }

        guard
            let thumbnail = CrateArtworkDownsampler.decode(
                data: encoded as Data,
                maxPixelSize: 512
            )
        else {
            fatalError("Unable to decode bounded artwork")
        }
        guard max(thumbnail.width, thumbnail.height) <= 512 else {
            fatalError(
                "Artwork was decoded at \(thumbnail.width)x\(thumbnail.height)"
            )
        }
    }
}
