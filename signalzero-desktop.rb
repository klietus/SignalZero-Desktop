cask "signalzero-desktop" do
  version "1.0.0"
  sha256 "b0c8c6dc64ff4b05b567e50eac32eb722287e20e4ec81929c9f744786b5c8a01"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/SignalZero.Desktop-#{version}-arm64.dmg"
  name "SignalZero Desktop"
  desc "Recursive Symbolic Reasoning Kernel"
  homepage "https://github.com/klietus/SignalZero-Desktop"

  app "SignalZero Desktop.app"

  zap trash: [
    "~/Library/Application Support/signal-zero-desktop",
    "~/Library/Preferences/com.signalzero.desktop.plist",
    "~/Library/Saved Application State/com.signalzero.desktop.savedState",
  ]
end
