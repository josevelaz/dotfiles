import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "jose.software-updates"

  readonly property string helperPath: (Quickshell.env("HOME") || "") + "/.local/bin/software-updates-picker"

  Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  function openPicker() {
    if (!root.bar) return
    root.bar.run("omarchy-launch-floating-terminal-with-presentation " + Util.shellQuote(root.helperPath))
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf019"
    slotSize: Style.bar.statusSlot
    tooltipText: strings.t("bar.checkUpdates")
    onPressed: root.openPicker()
  }
}
