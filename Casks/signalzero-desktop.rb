cask "signalzero-desktop" do
  version "1.1.8"
  sha256 "b63a7c0a7d4cbb85760c0e2afb8ba8b899da1148ccb94f66d9f5af8d9d9e8ac2"

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
