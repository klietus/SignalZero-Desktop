cask "signalzero-desktop" do
  version "1.1.3"
  sha256 "b40d8ce6cda9ae52b1b86347c0aae665e4b995d3f2da46220f0708385a4a399c"

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
