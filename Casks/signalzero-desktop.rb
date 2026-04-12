cask "signalzero-desktop" do
  version "1.1.7"
  sha256 "a374abd6add9e57e9985784aabce84b0ff8185f1ac000814b0ae944a5303fcde"

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
