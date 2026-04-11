cask "signalzero-desktop" do
  version "1.1.5"
  sha256 "e7b2425e9c7aa47b5c9a1b3e577b1a4eaf2db064e45d3a37c23eaa7599067706"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/SignalZero-Desktop-#{version}-arm64.dmg"
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
