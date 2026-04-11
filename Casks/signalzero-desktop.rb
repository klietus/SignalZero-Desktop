cask "signalzero-desktop" do
  version "1.1.1"
  sha256 "f8f4d5ec44c2802aa88e346645df5c8048019849cc421d25772267d854a6c8c7"

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
