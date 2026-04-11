cask "signalzero-desktop" do
  version "1.1.0"
  sha256 "5d2f3f2e0fceabfa80f342c570e73d0018c4d737cab6a87c7bd82b300e336577"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/SignalZero%20Desktop-#{version}-arm64.dmg"
  name "SignalZero-Desktop"
  desc "Recursive Symbolic Reasoning Kernel"
  homepage "https://github.com/klietus/SignalZero-Desktop"

  app "SignalZero-Desktop.app"

  zap trash: [
    "~/Library/Application Support/signal-zero-desktop",
    "~/Library/Preferences/com.signalzero.desktop.plist",
    "~/Library/Saved Application State/com.signalzero.desktop.savedState",
  ]
end
