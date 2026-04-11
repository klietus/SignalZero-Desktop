cask "signalzero-desktop" do
  version "1.1.2"
  sha256 "0eb856b63104fe22485ffe1ad305b0bfa96f98cf4128263f1cfc20ab99f5c720"

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
