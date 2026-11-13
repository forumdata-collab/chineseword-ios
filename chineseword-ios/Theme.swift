import UIKit

/// Colours shared with the Android app (MainActivity INK / VERMILION / PAPER …).
enum Theme {
    static let ink = UIColor(red: 0x2B / 255, green: 0x26 / 255, blue: 0x20 / 255, alpha: 1)
    static let vermilion = UIColor(red: 0xA9 / 255, green: 0x32 / 255, blue: 0x26 / 255, alpha: 1)
    static let paper = UIColor(red: 0xF8 / 255, green: 0xF6 / 255, blue: 0xF2 / 255, alpha: 1)
    static let hairline = UIColor(red: 0xD8 / 255, green: 0xCF / 255, blue: 0xC0 / 255, alpha: 1)
    static let gold = UIColor(red: 0x8A / 255, green: 0x6D / 255, blue: 0x3B / 255, alpha: 1)
    static let caption = UIColor(red: 0x5C / 255, green: 0x53 / 255, blue: 0x46 / 255, alpha: 1)
    static let sealRed = UIColor(red: 0xA9 / 255, green: 0x32 / 255, blue: 0x26 / 255, alpha: 1)
    static let sealInk = UIColor(red: 0xFD / 255, green: 0xF6 / 255, blue: 0xE3 / 255, alpha: 1)
    // Dark theme (matches the injected html.cw-dark CSS variables).
    static let darkBG = UIColor(red: 0x1A / 255, green: 0x17 / 255, blue: 0x14 / 255, alpha: 1)
    static let darkPaper = UIColor(red: 0x22 / 255, green: 0x1E / 255, blue: 0x1A / 255, alpha: 1)
    static let darkInk = UIColor(red: 0xE8 / 255, green: 0xE0 / 255, blue: 0xD0 / 255, alpha: 1)
    static let darkVermilion = UIColor(red: 0xD4 / 255, green: 0x65 / 255, blue: 0x4A / 255, alpha: 1)
    static let darkHairline = UIColor(red: 0x4A / 255, green: 0x40 / 255, blue: 0x38 / 255, alpha: 1)
}
