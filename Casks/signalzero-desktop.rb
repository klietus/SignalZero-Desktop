cask "signalzero-desktop" do
  version "1.2.0"
  sha256 "941bd13d1687eb5d28f50c90cb32d34ab9fc4dd5e3809398c5e352e821803bd0"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/Signal%20Zero-#{version}-arm64.dmg"
  name "Signal Zero"
  desc "Recursive Symbolic Reasoning Kernel"
  homepage "https://github.com/klietus/SignalZero-Desktop"

  app "Signal Zero.app"

  zap trash: [
    "~/Library/Application Support/signal-zero-desktop",
    "~/Library/Preferences/com.signalzero.desktop.plist",
    "~/Library/Saved Application State/com.signalzero.desktop.savedState",
  ]
end
