import CoreGraphics
import Foundation

// Prints "id<TAB>app<TAB>title" for every on-screen window.
// Feed an id to: screencapture -x -o -l <id> window.png
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
for window in windows {
    let id = window[kCGWindowNumber as String] as? Int ?? 0
    let owner = window[kCGWindowOwnerName as String] as? String ?? "?"
    let title = window[kCGWindowName as String] as? String ?? ""
    print("\(id)\t\(owner)\t\(title)")
}
