import AppKit

// Prints each screen's AppKit frame and backing scale.
// AppKit y grows up from the bottom of the main display;
// screencapture -R y grows down from its top.
for screen in NSScreen.screens {
    let frame = screen.frame
    let main = screen == NSScreen.main ? " main" : ""
    print(
        "frame=\(Int(frame.minX)),\(Int(frame.minY)) "
            + "\(Int(frame.width))x\(Int(frame.height)) "
            + "scale=\(screen.backingScaleFactor)\(main)"
    )
}
